import { PoseLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";

const canvas = document.querySelector("#overlay");
const ctx = canvas?.getContext("2d");

if (canvas && ctx && PoseLandmarker?.prototype?.detectForVideo) {
  const originalDetectForVideo = PoseLandmarker.prototype.detectForVideo;
  const edgeCanvas = document.createElement("canvas");
  const edgeCtx = edgeCanvas.getContext("2d", { willReadFrequently: true });
  let edgeImageData = null;
  let smoothedMask = null;
  let lastMaskWidth = 0;
  let lastMaskHeight = 0;

  function ensureBuffers(width, height) {
    if (width === lastMaskWidth && height === lastMaskHeight && edgeImageData && smoothedMask) return;
    lastMaskWidth = width;
    lastMaskHeight = height;
    edgeCanvas.width = width;
    edgeCanvas.height = height;
    edgeImageData = edgeCtx.createImageData(width, height);
    smoothedMask = new Float32Array(width * height);
  }

  function clearGlow() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  function drawOutlineOnly(result) {
    clearGlow();
    if (!result?.landmarks?.length) return;

    const mask = result.segmentationMasks?.[0];
    if (!mask) return;

    try {
      const width = mask.width;
      const height = mask.height;
      const values = mask.getAsFloat32Array();
      ensureBuffers(width, height);

      // 時間平滑：避免 segmentation 每幀細微抖動造成「鬼影閃爍」。
      const keep = 0.82;
      const add = 1 - keep;
      for (let i = 0; i < values.length; i++) {
        smoothedMask[i] = smoothedMask[i] * keep + values[i] * add;
      }

      const pixels = edgeImageData.data;
      pixels.fill(0);
      const threshold = 0.56;
      const radius = 2;

      for (let y = radius; y < height - radius; y++) {
        for (let x = radius; x < width - radius; x++) {
          const index = y * width + x;
          if (smoothedMask[index] < threshold) continue;

          let boundary = false;
          for (let oy = -radius; oy <= radius && !boundary; oy++) {
            for (let ox = -radius; ox <= radius; ox++) {
              if (!ox && !oy) continue;
              const neighbour = (y + oy) * width + (x + ox);
              if (smoothedMask[neighbour] < threshold - 0.08) {
                boundary = true;
                break;
              }
            }
          }
          if (!boundary) continue;

          const p = index * 4;
          pixels[p] = 255;
          pixels[p + 1] = 222;
          pixels[p + 2] = 76;
          pixels[p + 3] = 235;
        }
      }

      edgeCtx.putImageData(edgeImageData, 0, 0);

      // 只畫外緣：一層淡光 + 一層清楚細線，內部保持完全透明。
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 0.48;
      ctx.filter = "blur(8px)";
      ctx.drawImage(edgeCanvas, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 0.82;
      ctx.filter = "blur(2px)";
      ctx.drawImage(edgeCanvas, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    } catch (_) {
      clearGlow();
    }
  }

  PoseLandmarker.prototype.detectForVideo = function (...args) {
    const result = originalDetectForVideo.apply(this, args);
    // main.js 會先完成自己的繪製；microtask 在瀏覽器真正 paint 前覆蓋成乾淨外框。
    queueMicrotask(() => drawOutlineOnly(result));
    return result;
  };
}
