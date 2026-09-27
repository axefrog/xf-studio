/**
 * The Expressions view contribution (feature module #2): one panel, the controls drawer, in the inspector slot. Its ID follows the
 * `<feature>.<panel>` rule. Data only: the composition list (`compose/views.ts`) reads it without loading the panel.
 */
import { panelMeta, type ViewContribution } from "../../../studio-ui/views/contribution";

export const EXPRESSIONS_VIEW = {
  owner: "expressions",
  panels: [
    { id: "expressions.controls", title: "Expression", icon: "character", order: 115, slot: "inspect",
      description: "V's facial expression: start from rest or an installed expression, and set the face's own controls." },
  ],
  activity: [{ pattern: /^expression\./, label: "Expression" }],
} as const satisfies ViewContribution;

export const EXPRESSIONS_PANEL_META = panelMeta(EXPRESSIONS_VIEW);
