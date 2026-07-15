/**
 * Tile extraction for the chess-tiles CNN. Port of getChessTilesGray
 * from Elucidation/tensorflow_chessbot (MIT).
 *
 * Crops the board (edge-padding out-of-bounds corners), bilinear
 * resizes to 256x256, normalizes to [0,1], and emits the 64 tiles in
 * the model's input order: tile k = rank*8 + file with A1 at the
 * image's bottom-left, each tile a row-major 32x32 block. Output is
 * a Float32Array of shape [64, 1024].
 */

import type { BoardCorners, GrayImage } from "./detect";

const BOARD_PX = 256;
const TILE_PX = 32;
export const TILE_INPUT_SIZE = TILE_PX * TILE_PX;

/** Sample with edge clamping (np.pad mode="edge" equivalent). */
function sampleClamped(img: GrayImage, x: number, y: number): number {
  const cx = Math.min(img.width - 1, Math.max(0, x));
  const cy = Math.min(img.height - 1, Math.max(0, y));
  return img.data[cy * img.width + cx];
}

/** Bilinear resize of the corners crop to 256x256, values in [0,1]. */
export function extractBoardImage(img: GrayImage, corners: BoardCorners): Float32Array {
  const { x0, y0, x1, y1 } = corners;
  const cw = x1 - x0;
  const ch = y1 - y0;
  const out = new Float32Array(BOARD_PX * BOARD_PX);
  for (let ty = 0; ty < BOARD_PX; ty++) {
    const sy = y0 + ((ty + 0.5) * ch) / BOARD_PX - 0.5;
    const fy = Math.floor(sy);
    const wy = sy - fy;
    for (let tx = 0; tx < BOARD_PX; tx++) {
      const sx = x0 + ((tx + 0.5) * cw) / BOARD_PX - 0.5;
      const fx = Math.floor(sx);
      const wx = sx - fx;
      const v =
        sampleClamped(img, fx, fy) * (1 - wx) * (1 - wy) +
        sampleClamped(img, fx + 1, fy) * wx * (1 - wy) +
        sampleClamped(img, fx, fy + 1) * (1 - wx) * wy +
        sampleClamped(img, fx + 1, fy + 1) * wx * wy;
      out[ty * BOARD_PX + tx] = v / 255;
    }
  }
  return out;
}

/** Slice the 256x256 board into the [64, 1024] model input. */
export function boardToTiles(board: Float32Array): Float32Array {
  const out = new Float32Array(64 * TILE_INPUT_SIZE);
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const tile = rank * 8 + file;
      const srcY0 = (7 - rank) * TILE_PX;
      const srcX0 = file * TILE_PX;
      for (let y = 0; y < TILE_PX; y++) {
        const srcRow = (srcY0 + y) * BOARD_PX + srcX0;
        const dstRow = tile * TILE_INPUT_SIZE + y * TILE_PX;
        for (let x = 0; x < TILE_PX; x++) {
          out[dstRow + x] = board[srcRow + x];
        }
      }
    }
  }
  return out;
}

export function extractTiles(img: GrayImage, corners: BoardCorners): Float32Array {
  return boardToTiles(extractBoardImage(img, corners));
}

/** RGBA ImageData bytes to 0-255 grayscale (ITU-R 601 luma). */
export function rgbaToGray(rgba: Uint8ClampedArray, width: number, height: number): GrayImage {
  const data = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const off = i * 4;
    data[i] = 0.299 * rgba[off] + 0.587 * rgba[off + 1] + 0.114 * rgba[off + 2];
  }
  return { data, width, height };
}
