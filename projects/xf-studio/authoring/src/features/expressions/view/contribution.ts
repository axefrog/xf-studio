/**
 * The Expressions view contribution (feature module #2): two panels in the inspector slot, the controls drawer and the expression sets. Its ID follows the
 * `<feature>.<panel>` rule. Data only: the composition list (`compose/views.ts`) reads it without loading the panel.
 */
import { panelMeta, type ViewContribution } from "../../../studio-ui/views/contribution";

export const EXPRESSIONS_VIEW = {
  owner: "expressions",
  panels: [
    { id: "expressions.controls", title: "Expression", icon: "character", order: 115, slot: "inspect",
      description: "V's facial expression: start from rest or an installed expression, and set the face's own controls." },
    { id: "expressions.sets", title: "Expression sets", icon: "package", order: 116, slot: "inspect",
      description: "Group your saved expressions into sets; each set becomes its own photo-mode expression mod." },
  ],
  activity: [{ pattern: /^expression\./, label: "Expression" }],
} as const satisfies ViewContribution;

export const EXPRESSIONS_PANEL_META = panelMeta(EXPRESSIONS_VIEW);
