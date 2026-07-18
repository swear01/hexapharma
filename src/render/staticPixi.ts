export const STATIC_PIXI_OPTIONS = { autoStart: false } as const;

export function renderStaticFrame(app: { render(): void }): void {
  app.render();
}
