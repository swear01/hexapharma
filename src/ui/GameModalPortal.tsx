import type { ReactNode } from "react";
import { createPortal } from "react-dom";

interface GameModalPortalProps {
  readonly children: ReactNode;
}

export function GameModalPortal({ children }: GameModalPortalProps) {
  return createPortal(children, document.body);
}
