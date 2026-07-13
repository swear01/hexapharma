/**
 * HexaPharma — top-level entry. Research, Pilot Plant, and Production share one
 * authoritative game state; Market, Technology, and Blueprints are HUD drawers.
 */
import { Game } from "./Game";

export function Root() {
  return <Game />;
}
