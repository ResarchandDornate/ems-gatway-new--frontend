/**
 * Charts on screen → one PNG, without a dependency.
 *
 * Recharts draws SVG whose colours come from CSS variables and classes. A
 * serialised SVG drawn into a canvas loses the page's stylesheet, so every
 * element's computed paint and font are copied inline first. The result is
 * stacked with each chart's title onto a white sheet, the way it would print.
 */

const PAINT = ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "fill-opacity", "stroke-opacity", "font-size", "font-family", "font-weight", "text-anchor", "dominant-baseline"];

function inlineStyles(src: SVGElement, dst: SVGElement) {
  const cs = getComputedStyle(src);
  dst.setAttribute("style", PAINT.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";"));
  const a = src.children, b = dst.children;
  for (let i = 0; i < a.length; i++) inlineStyles(a[i] as SVGElement, b[i] as SVGElement);
}

function svgImage(svg: SVGSVGElement): Promise<{ img: HTMLImageElement; w: number; h: number }> {
  const { width: w, height: h } = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ img, w, h }); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not draw the chart")); };
    img.src = url;
  });
}

export interface ChartSection { title: string; subtitle?: string; svg: SVGSVGElement }

/** Every section stacked on one white canvas, as a PNG data URL. */
export async function chartsToPng(heading: string, sections: ChartSection[]): Promise<string> {
  const scale = 2, pad = 24, titleH = 40, headH = 56;
  const imgs = await Promise.all(sections.map((s) => svgImage(s.svg)));
  const width = Math.max(600, ...imgs.map((i) => i.w)) + pad * 2;
  const height = headH + imgs.reduce((a, i) => a + titleH + i.h + pad, 0) + pad;

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#14202e";
  ctx.font = "600 16px Inter, system-ui, sans-serif";
  ctx.fillText(heading, pad, pad + 16);

  let y = headH;
  sections.forEach((s, i) => {
    ctx.fillStyle = "#14202e";
    ctx.font = "600 13px Inter, system-ui, sans-serif";
    ctx.fillText(s.title, pad, y + 16);
    if (s.subtitle) {
      ctx.fillStyle = "#5A6880";
      ctx.font = "11px Inter, system-ui, sans-serif";
      ctx.fillText(s.subtitle, pad, y + 32);
    }
    y += titleH;
    ctx.drawImage(imgs[i].img, pad, y, imgs[i].w, imgs[i].h);
    y += imgs[i].h + pad;
  });
  return canvas.toDataURL("image/png");
}

export function downloadDataUrl(filename: string, url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

/** Opens the image alone in a new window and starts the print dialog (print or save as PDF). */
export function printImage(title: string, url: string): void {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.title = title;
  const img = w.document.createElement("img");
  img.src = url;
  img.style.width = "100%";
  img.onload = () => { w.focus(); w.print(); };
  w.document.body.style.margin = "0";
  w.document.body.appendChild(img);
}
