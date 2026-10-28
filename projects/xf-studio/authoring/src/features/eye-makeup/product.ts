import type { ProductDefaults } from "../../platform/api/product";
import { EYE_MAKEUP_MOD } from "../../legacy/eye-makeup/mod-branding";
import { EYE_MAKEUP_FEATURE } from "../../legacy/eye-makeup/recipe-schema";

import { EYE_ARTISTRY_REQUIREMENTS, XBOX_UNSUPPORTED_MESSAGE } from "../../legacy/eye-makeup/mod-branding";
export { EYE_ARTISTRY_REQUIREMENTS, XBOX_UNSUPPORTED_MESSAGE } from "../../legacy/eye-makeup/mod-branding";
export const EYE_MAKEUP_PRODUCT: ProductDefaults = Object.freeze({ ...EYE_MAKEUP_MOD,
  legacyFeature: EYE_MAKEUP_FEATURE, requirements: EYE_ARTISTRY_REQUIREMENTS, unsupportedStoreMessage: XBOX_UNSUPPORTED_MESSAGE,
  installedHint: "to see it in the character creator",
  predecessorAdvice: "It's an older eye makeup mod: switch it off in Mod Organizer 2 if the two clash.",
  predecessorCaution: "The legacy Eye Artistry selector is enabled in the source profile and will be disabled only in the diagnostic clone.",
  predecessorAction: "Disable the legacy Eye Artistry mod only in that copied modlist." });
