import "../../index.css";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { ComposerSurface } from "./ComposerSurface";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("hides the context strip's outline where it tucks under the input", async () => {
  await act(async () =>
    root.render(<ComposerSurface.ContextStrip>main</ComposerSurface.ContextStrip>),
  );

  const strip = container.querySelector("[data-slot=composer-context-strip]")!;
  // Transparent over the 15px tucked under the input; without that stop the
  // strip's top edge draws across the bottom of the input.
  expect(getComputedStyle(strip, "::before").maskImage).toContain(
    "linear-gradient(to top, rgb(0, 0, 0) calc(100% - 15px), rgba(0, 0, 0, 0) calc(100% - 15px))",
  );
});
