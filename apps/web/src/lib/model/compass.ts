/**
 * Where a point of the model's horizontal plane shows in a compass drawn as the viewer sees that plane: `reach` from the
 * centre, at this angle from +X towards +Y, in SVG axes with y down. The model's Z-up (x, y, z) is the viewer's (x, z, −y),
 * so at the camera's azimuth θ a direction a shows along the screen's right as cos(a − θ) and into the screen as
 * sin(a − θ), which the camera's polar angle φ foreshortens by cos φ: full seen from straight above, none from the side.
 */
export function compassPoint(
  angleDeg: number,
  reach: number,
  { theta, phi }: { readonly theta: number; readonly phi: number },
): { readonly x: number; readonly y: number } {
  const turned = (angleDeg * Math.PI) / 180 - theta;
  return { x: reach * Math.cos(turned), y: -reach * Math.sin(turned) * Math.cos(phi) };
}
