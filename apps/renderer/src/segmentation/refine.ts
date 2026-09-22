/**
 * Edge refinement: a guided filter (He, Sun and Tang) that uses the camera
 * frame's luminance to pull the matte's edge onto the real edge in the image.
 *
 * The segmentation model sees the frame at 256x256, so its edge is a smooth
 * curve a few pixels away from where hair or a finger actually ends. Within a
 * small window the filter fits `matte = a * luminance + b`. Where the window
 * straddles a real image edge, the fit follows that edge; where the image is
 * flat, it degrades to a local average of the matte, which the threshold ramp
 * then re-sharpens into a smoother contour than the raw mask had. It cannot
 * create foreground more than two radii from where the model put some,
 * because every coefficient is fitted to the model's own values.
 *
 * Cost is linear in the mask area and independent of the radius: every mean
 * below is a separable running-sum box filter.
 */

/**
 * Regularisation of the fit. Smaller follows fainter image edges (good for
 * hair) at the cost of copying more background texture into the edge. Luma is
 * in `[0, 1]`, so 0.004 corresponds to a local contrast of about 0.06.
 */
export const REFINE_EPSILON = 0.004;

/** `1 / n` for each position of a clamped `(2r+1)` window along one axis. */
function inverseCounts(length: number, radius: number): Float64Array {
  const out = new Float64Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = 1 / (Math.min(i + radius, length - 1) - Math.max(i - radius, 0) + 1);
  }
  return out;
}

/**
 * Mean of `src` over a `(2r+1)^2` window, clamped at the borders (each output
 * is divided by the number of pixels actually inside the image).
 *
 * Both passes walk memory in row order: the vertical pass keeps one running
 * sum per column and slides it a row at a time, which is several times faster
 * than walking down columns.
 */
export function boxMean(
  src: Float32Array,
  dst: Float32Array,
  scratch: Float32Array,
  width: number,
  height: number,
  radius: number,
  columns: Float64Array = new Float64Array(width),
): void {
  const invX = inverseCounts(width, radius);
  const invY = inverseCounts(height, radius);

  // Horizontal pass into scratch, already divided by the horizontal count.
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    const firstEnd = Math.min(radius, width - 1);
    for (let x = 0; x <= firstEnd; x += 1) sum += src[row + x]!;
    for (let x = 0; x < width; x += 1) {
      scratch[row + x] = sum * invX[x]!;
      const enter = x + radius + 1;
      if (enter < width) sum += src[row + enter]!;
      const leave = x - radius;
      if (leave >= 0) sum -= src[row + leave]!;
    }
  }

  // Vertical pass into dst, one running sum per column.
  columns.fill(0);
  const firstEnd = Math.min(radius, height - 1);
  for (let y = 0; y <= firstEnd; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) columns[x] = columns[x]! + scratch[row + x]!;
  }
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    const inv = invY[y]!;
    for (let x = 0; x < width; x += 1) dst[row + x] = columns[x]! * inv;
    const enter = y + radius + 1;
    if (enter < height) {
      const enterRow = enter * width;
      for (let x = 0; x < width; x += 1) columns[x] = columns[x]! + scratch[enterRow + x]!;
    }
    const leave = y - radius;
    if (leave >= 0) {
      const leaveRow = leave * width;
      for (let x = 0; x < width; x += 1) columns[x] = columns[x]! - scratch[leaveRow + x]!;
    }
  }
}

/**
 * Converts RGBA bytes to luminance in `[0, 1]` (Rec. 601 weights, which is
 * what the eye and most webcams agree on closely enough for an edge guide).
 */
export function rgbaToLuma(rgba: Uint8ClampedArray, count: number, out: Float32Array): void {
  for (let i = 0, o = 0; i < count; i += 1, o += 4) {
    out[i] = (0.299 * rgba[o]! + 0.587 * rgba[o + 1]! + 0.114 * rgba[o + 2]!) / 255;
  }
}

/**
 * Averages `src` down by `factor` in each direction (partial blocks at the
 * right and bottom edges average what they have).
 */
export function downsample(
  src: Float32Array,
  width: number,
  height: number,
  factor: number,
  dst: Float32Array,
): void {
  const outWidth = Math.ceil(width / factor);
  const outHeight = Math.ceil(height / factor);
  for (let oy = 0; oy < outHeight; oy += 1) {
    const y0 = oy * factor;
    const y1 = Math.min(y0 + factor, height);
    for (let ox = 0; ox < outWidth; ox += 1) {
      const x0 = ox * factor;
      const x1 = Math.min(x0 + factor, width);
      let sum = 0;
      for (let y = y0; y < y1; y += 1) {
        const row = y * width;
        for (let x = x0; x < x1; x += 1) sum += src[row + x]!;
      }
      dst[oy * outWidth + ox] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
}

/** Bilinear sampling positions for upsampling one axis by `factor`. */
interface AxisSamples {
  readonly lower: Int32Array;
  readonly upper: Int32Array;
  readonly weight: Float32Array;
}

function axisSamples(length: number, coarse: number, factor: number): AxisSamples {
  const lower = new Int32Array(length);
  const upper = new Int32Array(length);
  const weight = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    // Centre of fine pixel i, in coarse pixel coordinates.
    const u = Math.min(Math.max((i + 0.5) / factor - 0.5, 0), coarse - 1);
    const l = Math.floor(u);
    lower[i] = l;
    upper[i] = Math.min(l + 1, coarse - 1);
    weight[i] = u - l;
  }
  return { lower, upper, weight };
}

/** Factor the filter's coefficients are fitted at, relative to the mask. */
export const REFINE_SUBSAMPLE = 2;

/**
 * Owns the scratch buffers for the guided filter so a live pipeline does not
 * allocate per frame. Buffers are sized for the most recent mask and dropped
 * by `reset()`.
 *
 * This is the "fast guided filter" variant (He and Sun, 2015): the linear
 * coefficients vary slowly, so they are fitted on a half-resolution copy and
 * upsampled, then applied against the full-resolution guide. The detail comes
 * from that last step, so the edge still follows the full-resolution image,
 * at about a quarter of the cost.
 */
export class GuidedMatteRefiner {
  private key = '';
  private coarseI = new Float32Array(0);
  private coarseP = new Float32Array(0);
  private meanI = new Float32Array(0);
  private meanP = new Float32Array(0);
  private corrII = new Float32Array(0);
  private corrIP = new Float32Array(0);
  private a = new Float32Array(0);
  private b = new Float32Array(0);
  private work = new Float32Array(0);
  private scratch = new Float32Array(0);
  private columns = new Float64Array(0);
  private rowA = new Float32Array(0);
  private rowB = new Float32Array(0);
  private xs: AxisSamples | null = null;
  private ys: AxisSamples | null = null;

  /** Coarse pixels of scratch space currently held. */
  get size(): number {
    return this.meanI.length;
  }

  reset(): void {
    this.key = '';
    this.coarseI = new Float32Array(0);
    this.coarseP = new Float32Array(0);
    this.meanI = new Float32Array(0);
    this.meanP = new Float32Array(0);
    this.corrII = new Float32Array(0);
    this.corrIP = new Float32Array(0);
    this.a = new Float32Array(0);
    this.b = new Float32Array(0);
    this.work = new Float32Array(0);
    this.scratch = new Float32Array(0);
    this.columns = new Float64Array(0);
    this.rowA = new Float32Array(0);
    this.rowB = new Float32Array(0);
    this.xs = null;
    this.ys = null;
  }

  private ensure(width: number, height: number, factor: number): void {
    const key = `${width}x${height}/${factor}`;
    if (this.key === key) return;
    this.key = key;
    const coarseWidth = Math.ceil(width / factor);
    const coarseHeight = Math.ceil(height / factor);
    const count = coarseWidth * coarseHeight;
    this.coarseI = new Float32Array(count);
    this.coarseP = new Float32Array(count);
    this.meanI = new Float32Array(count);
    this.meanP = new Float32Array(count);
    this.corrII = new Float32Array(count);
    this.corrIP = new Float32Array(count);
    this.a = new Float32Array(count);
    this.b = new Float32Array(count);
    this.work = new Float32Array(count);
    this.scratch = new Float32Array(count);
    this.columns = new Float64Array(coarseWidth);
    this.rowA = new Float32Array(coarseWidth);
    this.rowB = new Float32Array(coarseWidth);
    this.xs = axisSamples(width, coarseWidth, factor);
    this.ys = axisSamples(height, coarseHeight, factor);
  }

  /**
   * Refines `matte` in place, guided by `luma`. Both are `width * height`,
   * row-major, and must describe the same frame. `radius` is in coarse
   * pixels, so the window spans about `(2 * radius + 1) * REFINE_SUBSAMPLE`
   * mask pixels. Output is clamped to `[0, 1]`. A radius of 0 leaves the
   * matte untouched.
   */
  refine(
    matte: Float32Array,
    luma: Float32Array,
    width: number,
    height: number,
    radius: number,
    epsilon: number = REFINE_EPSILON,
    factor: number = REFINE_SUBSAMPLE,
  ): void {
    const count = width * height;
    if (radius <= 0 || count <= 0 || matte.length < count || luma.length < count) return;
    this.ensure(width, height, factor);

    const coarseWidth = Math.ceil(width / factor);
    const coarseHeight = Math.ceil(height / factor);
    const coarseCount = coarseWidth * coarseHeight;
    const { coarseI, coarseP, meanI, meanP, corrII, corrIP, a, b, work, scratch, columns } =
      this;
    const box = (src: Float32Array, dst: Float32Array) =>
      boxMean(src, dst, scratch, coarseWidth, coarseHeight, radius, columns);

    downsample(luma, width, height, factor, coarseI);
    downsample(matte, width, height, factor, coarseP);

    box(coarseI, meanI);
    box(coarseP, meanP);
    for (let i = 0; i < coarseCount; i += 1) work[i] = coarseI[i]! * coarseI[i]!;
    box(work, corrII);
    for (let i = 0; i < coarseCount; i += 1) work[i] = coarseI[i]! * coarseP[i]!;
    box(work, corrIP);

    for (let i = 0; i < coarseCount; i += 1) {
      const mI = meanI[i]!;
      const mP = meanP[i]!;
      const variance = corrII[i]! - mI * mI;
      const covariance = corrIP[i]! - mI * mP;
      const slope = covariance / (variance + epsilon);
      a[i] = slope;
      b[i] = mP - slope * mI;
    }

    // meanI and meanP are free again; reuse them for the averaged coefficients.
    box(a, meanI);
    box(b, meanP);

    // Upsample the coefficients bilinearly and apply them to the full guide:
    // blend the two coarse rows once per output row, then along x per pixel.
    const xs = this.xs!;
    const ys = this.ys!;
    const { rowA, rowB } = this;
    for (let y = 0; y < height; y += 1) {
      const top = ys.lower[y]! * coarseWidth;
      const bottom = ys.upper[y]! * coarseWidth;
      const fy = ys.weight[y]!;
      for (let cx = 0; cx < coarseWidth; cx += 1) {
        const aTop = meanI[top + cx]!;
        const bTop = meanP[top + cx]!;
        rowA[cx] = aTop + (meanI[bottom + cx]! - aTop) * fy;
        rowB[cx] = bTop + (meanP[bottom + cx]! - bTop) * fy;
      }
      const row = y * width;
      for (let x = 0; x < width; x += 1) {
        const left = xs.lower[x]!;
        const right = xs.upper[x]!;
        const fx = xs.weight[x]!;
        const aLeft = rowA[left]!;
        const bLeft = rowB[left]!;
        const slope = aLeft + (rowA[right]! - aLeft) * fx;
        const offset = bLeft + (rowB[right]! - bLeft) * fx;
        const q = slope * luma[row + x]! + offset;
        matte[row + x] = q < 0 ? 0 : q > 1 ? 1 : q;
      }
    }
  }
}
