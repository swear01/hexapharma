/**
 * HexaPharma — top-level entry. The full game loop (Lab | Factory | Shop |
 * Patents + Cash/Save bar over ONE shared game state) lives in Game.tsx.
 */
import { Game } from "./Game";

export function Root() {
  return <Game />;
}
