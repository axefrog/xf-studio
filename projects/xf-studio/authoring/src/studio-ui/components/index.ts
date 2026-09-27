/**
 * The XF Studio component library (research/authoring/ui-component-library.md, style guide "Component library"). Panels and feature
 * views compose these; they do not build controls of their own (tests/ui-component-ratchet.test.ts). A feature that needs a control
 * the library lacks specifies it (behaviour, states, accessibility) and the UI component track builds it here, with its style-guide
 * entry (`catalogue.ts`). Components that only one feature uses still live here, in the feature-specific category.
 *
 * The established primitives predate this folder and stay where they are for now (moving them would break parallel branches); this
 * entry point is where new code imports them from.
 */
export { applyCapability, badge, bindRangeTransaction, button, ColorField, EmptyState, emptyState, fillRange, note, NoteLine, section, Segmented,
  SelectField, Slider, Toggle, type SegmentOption, type Transaction } from "../controls";
export { ExpandAll, expander, expanderLabel, isExpanded, setExpanded, type ExpanderLevel } from "../expander";
export { helpTip, installHelpTips, setHelp, type HelpText } from "../help-tip";
export { installReasonTips } from "../reason-tip";
export { closeMenus, menuFromSections, openConfirmPopover, openMenu, openValuePopover, type Capability, type MenuItem, type MenuSection, type ValueField, type ValueOption } from "../menu";
export { ItemList, type ItemListOptions, type ListItem, type ListRow } from "../item-list";
export { iconButton, type IconButtonOptions } from "./icon-button";
export { planTabs, TabStrip, TAB_STAGES, type TabItem, type TabStripOptions, type TabStripStage } from "./tab-strip";
export { DRAG_MIN, HeaderFitter, PanelHeader, type PanelHeaderOptions } from "./panel-header";
export { SliderWithValue, type SliderWithValueOptions } from "./slider-with-value";
export { PairControl, type PairControlOptions, type PairEdit, type Side } from "./pair-control";
export { BipolarSlider, type BipolarSliderOptions } from "./bipolar-slider";
export { ScrubSlider, SCRUB_REST, type ScrubCurve, type ScrubSliderOptions } from "./scrub-slider";
export { GroupSection, type GroupSectionOptions } from "./group-section";
// Remembered view state: folds and scroll positions across reloads (view-state.ts, scroll-anchor.ts).
export { RememberedSet } from "../view-state";
export { holdScroll, revealInView, ScrollMemory, VIEW_KEY, type ScrollMemoryOptions } from "../scroll-anchor";
export { SearchField, type SearchFieldOptions } from "./search-field";
export { Combobox, type ComboboxOptions, type ComboGroup, type ComboOption } from "./combobox";
export { blockSection, codeBlock, PageHeader, propertyList, stack, type Gap, type Property } from "./layout";
export { SplitView, type SplitViewOptions } from "./split-view";
export { Splitter, type SplitterOptions } from "./splitter";
export { favouriteToggle, TreeView, TREE_ROW_HEIGHT, type TreeBadge, type TreeGroupData, type TreeItemRef, type TreeRowData, type TreeViewOptions } from "./tree-view";
export { progressBar, type ProgressBar } from "./progress";
export { attachSwatchCard, ChoiceList, choiceItem, swatchCard, type ChoiceListOptions, type ChoiceOption } from "./choice-list";
export { FolderSetting, type FolderChoice, type FolderOutcome, type FolderSettingOptions, type FolderSettingState } from "./folder-setting";
export { contrastMark, CONTRAST_WORDS, sampleBackground, setContrastMark, SwatchCard, type SwatchCardOptions, type SwatchSample } from "./swatch-card";
// Feature-specific: lighting setups.
export { LightList, type LightListItem, type LightListOptions } from "./light-list";
export { azimuthWords, DIAL_DEFAULT_SIZE, DIAL_MIN_SIZE, DirectionDial, dialDirection, dialPoint, dragDirection, fitDialSize, ANGLE_SNAP, heightTicks, heightY,
  snapStep, type DialMark, type Direction, type DirectionDialOptions } from "./direction-dial";
export { installPreviewFilter, PREVIEW_FILTER_IDS, PreviewSpin, previewStage, previewTile, previewTokens, SPIN, type PreviewStage, type PreviewTile,
  type PreviewTileState } from "./choice-preview";
export { pageStep, TypeAhead } from "./listbox-keys";
