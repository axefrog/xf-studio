import { clamp, randomAt, smooth, type ChartMapping, type Field, type MaterialSample, type Unit } from "./types";
export const constant = (value: number, unit: Unit): Field => ({ op: "constant", unit, chart: "scalp", value });
export function transportSample(sample: MaterialSample, mapping: ChartMapping): MaterialSample {
  const [a, b, c, d] = mapping.matrix, [x, y] = mapping.offset;
  if (![a, b, c, d, x, y].every(Number.isFinite) || Math.abs(a * d - b * c) < 1e-12) throw Error("Invalid chart binding.");
  const map = ([u, v]: readonly [number, number]): [number, number] => [a * u + b * v + x, c * u + d * v + y];
  return { ...sample, uv: map(sample.uv), cross: map(sample.cross) };
}
export function evaluateField(field: Field, sample: MaterialSample): number {
  const coords = field.chart === "scalp" ? sample.uv : sample.cross;
  switch (field.op) {
    case "constant": return field.value;
    case "ramp": { const t = field.axis === "u" ? coords[0] : field.axis === "v" ? coords[1] : sample[field.axis]; return field.from + t * (field.to - field.from); }
    case "variation": return field.from + randomAt(field.seed, sample.index) * (field.to - field.from);
    case "smoothstep": return smooth(field.low, field.high, evaluateField(field.input, sample));
    case "override": return evaluateField(field.b, sample);
    case "multiply": return evaluateField(field.a, sample) * evaluateField(field.b, sample);
    case "blend": { const t = clamp(evaluateField(field.mask, sample)); return evaluateField(field.a, sample) * (1 - t) + evaluateField(field.b, sample) * t; }
    case "min": case "max": {
      const a = evaluateField(field.a, sample), b = evaluateField(field.b, sample), k = field.smoothness;
      const h = Math.max(k - Math.abs(a - b), 0) / k;
      return field.op === "min" ? Math.min(a, b) - h * h * k / 4 : Math.max(a, b) + h * h * k / 4;
    }
  }
}
export function validateField(field: Field, depth = 0): string[] {
  const issues: string[] = [];
  if (!field || depth > 32 || !["m", "rad", "ratio"].includes(field.unit) || !["scalp", "volume"].includes(field.chart)) return ["Invalid field unit, chart or nesting."];
  const finite = (...n: number[]) => { if (!n.every(Number.isFinite)) issues.push("Field values must be finite."); };
  const child = (f: Field, unit: Unit) => { issues.push(...validateField(f, depth + 1)); if (f?.unit !== unit) issues.push("Field units disagree."); };
  switch (field.op) {
    case "constant": finite(field.value); break;
    case "ramp": finite(field.from, field.to); if (!["u", "v", "distance", "entrance"].includes(field.axis)) issues.push("Unknown field axis."); break;
    case "variation": finite(field.seed, field.from, field.to); break;
    case "smoothstep": finite(field.low, field.high); if (field.low >= field.high || field.unit !== "ratio") issues.push("Threshold must have a soft edge and ratio output."); issues.push(...validateField(field.input, depth + 1)); break;
    case "multiply": child(field.a, field.unit); child(field.b, "ratio"); break;
    case "override": child(field.a, field.unit); child(field.b, field.unit); break;
    case "blend": child(field.a, field.unit); child(field.b, field.unit); child(field.mask, "ratio"); break;
    case "min": case "max": child(field.a, field.unit); child(field.b, field.unit); finite(field.smoothness); if (!(field.smoothness > 0)) issues.push("Soft extrema need positive smoothness."); break;
    default: issues.push("Unknown field expression.");
  }
  return issues;
}
