// Cover the viewport with spare room for a gentle, continuous photographic drift.
// Time comes from the scene clock, so pausing or hiding the page freezes the sky.
export function skyPhotoPlacement(width, height, imageWidth, imageHeight, time) {
  const scale = Math.max(width / imageWidth, height / imageHeight) * 1.08;
  const photoWidth = imageWidth * scale, photoHeight = imageHeight * scale;
  const phase = time / 240_000 * Math.PI * 2;
  return {
    x: (width - photoWidth) / 2 + width * .025 * Math.sin(phase),
    y: (height - photoHeight) / 2 + height * .006 * Math.sin(phase * 2),
    width: photoWidth, height: photoHeight,
  };
}

export function drawSky(ctx, photo, width, height, time) {
  if (photo?.complete && photo.naturalWidth > 0 && photo.naturalHeight > 0) {
    const placement = skyPhotoPlacement(width, height, photo.naturalWidth, photo.naturalHeight, time);
    ctx.drawImage(photo, placement.x, placement.y, placement.width, placement.height);
    return;
  }
  // A sky-coloured fallback also covers the brief image-loading interval.
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#287fb3'); gradient.addColorStop(1, '#bfddea');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
}
