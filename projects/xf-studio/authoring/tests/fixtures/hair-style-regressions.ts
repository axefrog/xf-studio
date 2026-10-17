import { defaultGroom, surfaceBounds } from "../../src/features/hair-lab/groom";
import { constant } from "../../src/features/hair-lab/fields";
import type { Field, HeadSurface } from "../../src/features/hair-lab/types";

/** Every style uses ordinary groom data through the same evaluator. */
export function regressionGrooms(head: HeadSurface) {
  const bounds = surfaceBounds(head), base = defaultGroom(head);
  const styles = Array.from({ length: 5 }, () => structuredClone(base));
  styles[0].name = "Long loose waves";

  const sidePart = styles[1];
  sidePart.name = "Side part and swept bangs";
  sidePart.flow = { ...base.flow!, part: -.55, foreheadDirection: [2.4, 0, -.15] };
  const u: Field = { op: "ramp", chart: "scalp", unit: "ratio", axis: "u", from: 0, to: 1 };
  const frontMask: Field = {
    op: "multiply", chart: "scalp", unit: "ratio",
    a: { op: "smoothstep", chart: "scalp", unit: "ratio", input: u, low: .32, high: .40 },
    b: {
      op: "blend", chart: "scalp", unit: "ratio", a: constant(1, "ratio"), b: constant(0, "ratio"),
      mask: { op: "smoothstep", chart: "scalp", unit: "ratio", input: u, low: .60, high: .68 },
    },
  };
  sidePart.fields.length = { op: "blend", chart: "scalp", unit: "m", a: constant(.55, "m"), b: constant(.20, "m"), mask: frontMask };

  const bob = styles[2];
  bob.name = "Jaw-length bob";
  bob.fields.length = constant(.55, "m");
  bob.cut = { normal: [0, 1, 0], offsetMetres: bounds.min[1] + .075 };
  bob.fields.waves = constant(.001, "m");
  bob.fields.tipCurl = constant(.75, "rad");

  const ponytail = styles[3];
  ponytail.name = "High ponytail";
  ponytail.fields.length = constant(.70, "m");
  ponytail.fields.waves = constant(.004, "m");
  ponytail.fields.spread = constant(.006, "m");
  ponytail.flow = { ...base.flow!, foreheadSweep: 0, rearPreference: 0 };
  for (const node of Object.values(ponytail.graph.nodes)) if (node.kind === "volume" && node.clump) node.next = "tie";
  ponytail.graph.nodes.tie = {
    kind: "convergence", next: "tail", tie: {
      position: [bounds.centre[0], bounds.centre[1] + bounds.size[1] * .43, bounds.centre[2] - (head.front?.[2] ?? -1) * bounds.size[2] * .48],
      radiusMetres: .012,
    },
  };
  ponytail.graph.nodes.tail = { kind: "volume", next: "end", length: "length", section: "tail", clump: "tail" };

  const sideShave = styles[4];
  sideShave.name = "Side shave";
  sideShave.flow = { ...base.flow!, part: -.35 };
  sideShave.scalp.density = base.scalp.density!.map((density, i) => head.positions[i * 3] < bounds.centre[0] - .018 ? 0 : density);
  return styles;
}
