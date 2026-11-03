import type { SchematicDocument, SchematicRectangle, SchematicShape } from "./schematic-types";

type Label = {
  id: string;
  itemId?: string;
  component: boolean;
  text: string;
  fullText: string;
  x: number;
  y: number;
  fontSize: number;
  background: string;
};

/** Choose the stronger text contrast on the illustration's white background. */
export function schematicTextColor(background: string) {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(background);
  if (!match) return "#17212b";
  const hex = match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join("") : match[1];
  const rgb = [0, 2, 4].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return luminance < 0.179 ? "#ffffff" : "#111827";
}

function intersection(a: SchematicRectangle, b: SchematicRectangle): SchematicRectangle | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function subtract(area: SchematicRectangle, obstacle: SchematicRectangle): SchematicRectangle[] {
  const cut = intersection(area, obstacle);
  if (!cut) return [area];
  return [
    { x: area.x, y: area.y, width: area.width, height: cut.y - area.y },
    { x: area.x, y: cut.y + cut.height, width: area.width, height: area.y + area.height - cut.y - cut.height },
    { x: area.x, y: cut.y, width: cut.x - area.x, height: cut.height },
    { x: cut.x + cut.width, y: cut.y, width: area.x + area.width - cut.x - cut.width, height: cut.height },
  ].filter((rect) => rect.width > 0 && rect.height > 0);
}

function bounds(shape: SchematicShape): SchematicRectangle | null {
  if (shape.kind === "rect") return { x: shape.x ?? 0, y: shape.y ?? 0, width: shape.width ?? 0, height: shape.height ?? 0 };
  if (shape.kind === "circle") {
    const r = shape.r ?? 0;
    return { x: (shape.cx ?? 0) - r, y: (shape.cy ?? 0) - r, width: r * 2, height: r * 2 };
  }
  if (!shape.points?.length) return null;
  const xs = shape.points.map(([x]) => x);
  const ys = shape.points.map(([, y]) => y);
  const padding = shape.strokeWidth / 2;
  return { x: Math.min(...xs) - padding, y: Math.min(...ys) - padding,
    width: Math.max(...xs) - Math.min(...xs) + padding * 2,
    height: Math.max(...ys) - Math.min(...ys) + padding * 2 };
}

function containedBy(inner: SchematicRectangle, outer: SchematicRectangle) {
  const epsilon = 0.01;
  return inner.x >= outer.x - epsilon && inner.y >= outer.y - epsilon
    && inner.x + inner.width <= outer.x + outer.width + epsilon
    && inner.y + inner.height <= outer.y + outer.height + epsilon;
}

function fitText(text: string, area: SchematicRectangle, maximumSize: number) {
  const fontSize = Math.min(maximumSize, Math.max(12, (area.height - 12) * 0.7));
  // Conservative average glyph width, including room for wide/CJK labels.
  const textWidth = [...text].reduce((width, char) => width + (/[^\x00-\xff]/.test(char) ? 1 : 0.65), 0);
  const fittedSize = Math.min(fontSize, (area.width - 20) / Math.max(1, textWidth));
  if (fittedSize >= 12) return { text, fontSize: fittedSize };
  const limit = Math.max(3, Math.floor((area.width - 20) / 12));
  return { text: `${text.slice(0, limit - 1)}…`, fontSize: 12 };
}

/** Work only from display shapes; no material or process-specific layout rules. */
export function schematicLabels(document: SchematicDocument): Label[] {
  const items = new Map(document.items.map((item) => [item.id, item]));
  const shapeBounds = document.shapes.map(bounds);
  const visibleBounds = document.shapes.map((shape, index) => {
    const rect = shapeBounds[index];
    const initial = rect && (shape.clip ? intersection(rect, shape.clip) : rect);
    let visible = initial ? [initial] : [];
    for (const exclusion of shape.clip?.exclusions ?? []) visible = visible.flatMap((area) => subtract(area, exclusion));
    return visible;
  });
  const hasLabelSpace = (area: SchematicRectangle) => area.width >= 64 && area.height >= 28;
  const areas = document.shapes.map((shape, index) => {
    const rect = shapeBounds[index];
    if (shape.kind !== "rect" || shape.fill === "none" || !rect || rect.width < 64 || rect.height < 28) return [];
    let visible = visibleBounds[index].filter(hasLabelSpace);
    for (let later = index + 1; later < document.shapes.length && visible.length; later++) {
      const covering = document.shapes[later];
      if (covering.itemId === shape.itemId || (covering.fill === "none" && covering.stroke === "none")) continue;
      for (const obstacle of visibleBounds[later]) visible = visible.flatMap((area) => subtract(area, obstacle)).filter(hasLabelSpace);
    }
    return visible;
  });
  const labels: Label[] = [];
  const componentShapes = new Set<number>();
  for (const component of document.components) {
    const candidates = document.shapes.flatMap((shape, index) => {
      if (items.get(shape.itemId)?.groupLabel !== component.label || !shapeBounds[index]
        || !containedBy(shapeBounds[index]!, component)) return [];
      componentShapes.add(index);
      return areas[index].map((area) => ({ area, shape }));
    }).sort((a, b) => b.area.width * b.area.height - a.area.width * a.area.height);
    const candidate = candidates[0];
    const area = candidate?.area ?? { x: component.x, y: Math.max(document.viewBox[1], component.y - 36), width: component.width, height: 28 };
    labels.push({ id: component.id, itemId: candidate?.shape.itemId, component: true, fullText: component.label,
      ...fitText(component.label, area, candidate ? 24 : 16), x: area.x + area.width / 2, y: area.y + area.height / 2,
      background: candidate?.shape.fill ?? "#ffffff" });
  }
  const labeledItems = new Set<string>();
  // Favor the largest exposed region, so clipped slabs get one quiet label.
  const candidates = document.shapes.flatMap((shape, index) => componentShapes.has(index) ? []
    : areas[index].map((area) => ({ shape, area })))
    .sort((a, b) => b.area.width * b.area.height - a.area.width * a.area.height);
  for (const { shape, area } of candidates) {
    const item = items.get(shape.itemId);
    if (!item || labeledItems.has(item.id)) continue;
    labeledItems.add(item.id);
    labels.push({ id: `label-${shape.id}`, itemId: item.id, component: false, fullText: item.label,
      ...fitText(item.label, area, 20), x: area.x + area.width / 2, y: area.y + area.height / 2,
      background: shape.fill });
  }
  return labels;
}
