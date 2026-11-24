import { canonicalTextLanguage, physicalTextAlignment } from "../../../../shared/text-flow.ts";
import { Button } from "open-design-ui/button";
import { IconButton } from "open-design-ui/icon-button";
import { NativeSelect } from "../ui/FormField";
import { RemixIcon } from "../../icons/RemixIcons";
import { useMvpEditor } from "../../motion/StudioHost";
import { useI18n } from "../../i18n/I18n";
import type { PropertyPanelProps } from "./propertyPanelTypes";
import { useEffect, useState } from "react";
import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import { Plus, X } from "../../icons/SystemIcons";
import { isTextEditableSelection, type DomEditSelection } from "./domEditing";
import type { ImportedFontAsset, FontImportInput } from "./fontAssets";
import { normalizeTextMetricValue } from "./propertyPanelHelpers";
import { ColorField } from "./propertyPanelColor";
import { FontFamilyField } from "./propertyPanelFont";
import { useInspectorProjectFont } from "./useInspectorProjectFont";
import { PromotableControl } from "./PromotableControl";
import { FlatRow, FlatSegmentedRow } from "./propertyPanelFlatPrimitives";
import {
  resolveValueTier,
  VALUE_TIER_LABEL_CLASS,
  VALUE_TIER_VALUE_CLASS,
} from "./propertyPanelValueTier";
import {
  detectAvailableWeights,
  formatTextFieldPreview,
  getTextFieldColor,
  getTextStyleValue,
  TextAreaField,
  WEIGHT_LABELS,
} from "./propertyPanelSections";

/* ------------------------------------------------------------------ */
/*  Flat text section (design_handoff_studio_inspector, #10a)          */
/* ------------------------------------------------------------------ */

const ALIGN_OPTIONS = [
  { key: "left", label: "left", node: "L" },
  { key: "center", label: "center", node: "C" },
  { key: "right", label: "right", node: "R" },
  { key: "justify", label: "justify", node: "J" },
];

const CASE_OPTIONS = [
  { key: "none", label: "none", node: "None" },
  { key: "uppercase", label: "uppercase", node: "AG" },
  { key: "lowercase", label: "lowercase", node: "ag" },
  { key: "capitalize", label: "capitalize", node: "Ag" },
];

function FlatTextFieldEditor({
  field,
  styles,
  fontAssets,
  previewDocument,
  onImportFonts,
  onSetText,
  onSetTextFieldStyle,
  onPreviewTextFieldStyle,
  onSetHtmlAttribute,
  autoFocus = false,
}: {
  field: DomEditSelection["textFields"][number];
  styles: Record<string, string>;
  fontAssets: ImportedFontAsset[];
  previewDocument?: Document;
  onImportFonts?: (files: FontImportInput) => Promise<ImportedFontAsset[]>;
  onSetText: (value: string, fieldKey?: string) => void;
  onSetTextFieldStyle: (fieldKey: string, property: string, value: string) => void;
  onPreviewTextFieldStyle?: (fieldKey: string, property: string, value: string) => void;
  /** Only supplied for the sole text field authored on the selected HTML element. */
  onSetHtmlAttribute?: PropertyPanelProps["onSetHtmlAttribute"];
  autoFocus?: boolean;
}) {
  const { t } = useI18n();
  const mvp = useMvpEditor();
  const track = useTrackDesignInput();
  const weight = getTextStyleValue(field, styles, "font-weight", "400");
  const weightOptions = detectAvailableWeights(
    field.computedStyles["font-family"] || styles["font-family"] || "",
  );
  const align = getTextStyleValue(field, styles, "text-align", "start");
  const direction = (field.computedStyles["direction"] || styles["direction"]) === "rtl" ? "rtl" : "ltr";
  const physicalAlign = physicalTextAlignment(align, direction);
  const textTransform = getTextStyleValue(field, styles, "text-transform", "none");
  const fontStyle = getTextStyleValue(field, styles, "font-style", "normal");
  const htmlDir = field.attributes.find((attr) => attr.name === "dir")?.value ?? "";
  const htmlLanguage = field.attributes.find((attr) => attr.name === "lang")?.value ?? "";
  const inspectorFont = useInspectorProjectFont(
    previewDocument, field.computedStyles["font-family"] || styles["font-family"] || "", fontAssets,
  );
  const [languageError, setLanguageError] = useState(false);
  useEffect(() => setLanguageError(false), [field.key, htmlLanguage]);

  return (
    <>
      <PromotableControl channel={{ kind: "text" }} enabled={field.source === "self"}>
        {({ value, onCommit }) => (
          <TextAreaField
            flat
            boxed={mvp}
            label={t("Content")}
            value={value ?? field.value}
            direction={direction}
            language={htmlLanguage}
            fontFamily={inspectorFont}
            autoFocus={autoFocus}
            onCommit={onCommit ?? ((next) => onSetText(next, field.key))}
          />
        )}
      </PromotableControl>
      <PromotableControl
        channel={{ kind: "style", prop: "font-family" }}
        enabled={field.source === "self"}
      >
        {({ value, onCommit }) => (
          <FontFamilyField
            flat
            value={
              value ?? (field.computedStyles["font-family"] || styles["font-family"] || "inherit")
            }
            importedFonts={fontAssets}
            onImportFonts={onImportFonts}
            onCommit={onCommit ?? ((next) => onSetTextFieldStyle(field.key, "font-family", next))}
          />
        )}
      </PromotableControl>
      <FlatRow
        label={t("Size")}
        boxed={mvp}
        stepper={mvp}
        value={field.computedStyles["font-size"] || styles["font-size"] || "16px"}
        tier={resolveValueTier(field.inlineStyles["font-size"], styles["font-size"] || "16px")}
        liveCommit
        onPreview={(next) => onPreviewTextFieldStyle?.(field.key, "font-size", next)}
        onCommit={(next) => onSetTextFieldStyle(field.key, "font-size", next)}
      />
      {!mvp && <>
      <div className="flex min-h-[30px] items-center justify-between">
        <span
          className={
            VALUE_TIER_LABEL_CLASS[resolveValueTier(field.inlineStyles["font-weight"], "400")]
          }
          style={{ fontSize: 11 }}
        >
          {t("Weight")}</span>
        <label className="flex items-center gap-1.5 border-b border-panel-border-input/50 pb-px hover:border-panel-border-input">
          <NativeSelect appearance="embedded"
            value={weight}
            onChange={(e) => {
              track("select", "Weight");
              onSetTextFieldStyle(field.key, "font-weight", e.target.value);
            }}
            className={`appearance-none bg-transparent text-right font-mono text-[11px] outline-hidden ${
              VALUE_TIER_VALUE_CLASS[resolveValueTier(field.inlineStyles["font-weight"], "400")]
            }`}
          >
            {(weightOptions.includes(weight) ? weightOptions : [weight, ...weightOptions]).map(
              (option) => (
                <option key={option} value={option}>
                  {t(WEIGHT_LABELS[option] ?? option)}
                </option>
              ),
            )}
          </NativeSelect>
          <RemixIcon name="arrow-down-s-line" size={14} className="shrink-0 text-panel-text-5" />
        </label>
      </div>
      <FlatRow
        label={t("Letter spacing")}
        value={getTextStyleValue(field, styles, "letter-spacing", "0px")}
        tier={resolveValueTier(field.inlineStyles["letter-spacing"], "0px")}
        onCommit={(next) =>
          onSetTextFieldStyle(
            field.key,
            "letter-spacing",
            normalizeTextMetricValue("letter-spacing", next),
          )
        }
        onReset={() => onSetTextFieldStyle(field.key, "letter-spacing", "")}
      />
      <FlatRow
        label={t("Line height")}
        value={getTextStyleValue(field, styles, "line-height", "normal")}
        tier={resolveValueTier(field.inlineStyles["line-height"], "normal")}
        onCommit={(next) =>
          onSetTextFieldStyle(
            field.key,
            "line-height",
            normalizeTextMetricValue("line-height", next),
          )
        }
        onReset={() => onSetTextFieldStyle(field.key, "line-height", "")}
      />
      </>}
      <FlatSegmentedRow
        filled={mvp}
        label={t("Align")}
        options={ALIGN_OPTIONS.filter(option => !mvp || option.key !== "justify").map((option) => ({
          key: option.key,
          node: mvp ? (
            <span className="flex h-4 w-4 items-center justify-center">
              <RemixIcon name={`align-${option.key}`} size={14} />
            </span>
          ) : option.node,
          label: mvp ? `Align ${option.key}` : option.label,
          active:
            physicalAlign === option.key,
        }))}
        onChange={(next) => {
          // Re-clicking the option that's already visually active for a
          // logical value (authored "start"/"end") must not rewrite it to
          // the physical "left"/"right" — that destroys the logical
          // semantics and is wrong for RTL content. Only write when the
          // user actually picked a different alignment.
          if (next === physicalAlign) {
            return;
          }
          onSetTextFieldStyle(field.key, "text-align", next);
        }}
      />
      {!mvp && (
        <FlatSegmentedRow
          label={t("Direction")}
          options={[
            { key: "ltr", node: "LTR", label: "Left to right", active: direction === "ltr" },
            { key: "rtl", node: "RTL", label: "Right to left", active: direction === "rtl" },
          ]}
          onChange={(next) => {
            // Use the existing source-backed per-field CSS style commit. A direction
            // change must not rewrite the copy, change logical text alignment, or
            // fabricate a semantic HTML dir/lang attribute.
            if (next !== direction) onSetTextFieldStyle(field.key, "direction", next);
          }}
        />
      )}
      {!mvp && onSetHtmlAttribute && (
        <>
          <FlatSegmentedRow
            label={t("HTML dir")}
            options={[
              { key: "", node: "—", label: "Inherit direction", active: htmlDir === "" },
              { key: "auto", node: "Auto", label: "Automatic direction", active: htmlDir === "auto" },
              { key: "ltr", node: "LTR", label: "HTML left to right", active: htmlDir === "ltr" },
              { key: "rtl", node: "RTL", label: "HTML right to left", active: htmlDir === "rtl" },
            ]}
            onChange={(next) => {
              if (next !== htmlDir) void onSetHtmlAttribute("dir", next || null);
            }}
          />
          <FlatRow
            label={t("Language tag")}
            value={htmlLanguage}
            tier={resolveValueTier(htmlLanguage, "")}
            onCommit={(next) => {
              const trimmed = next.trim();
              let canonical: string | undefined;
              try {
                canonical = trimmed ? canonicalTextLanguage(trimmed) : undefined;
              } catch {
                setLanguageError(true);
                throw new Error("INVALID_TEXT_LANGUAGE");
              }
              setLanguageError(false);
              if ((canonical ?? "") !== htmlLanguage) return onSetHtmlAttribute("lang", canonical ?? null);
            }}
            onReset={() => void onSetHtmlAttribute("lang", null)}
          />
          {languageError && (
            <span role="alert" className="text-[11px] text-red-400">
              {t("Invalid BCP-47 language tag")}
            </span>
          )}
        </>
      )}
      {!mvp && (
        <FlatSegmentedRow
          label={t("Case · Style")}
          options={[
            ...CASE_OPTIONS.map((option) => ({
              key: option.key,
              node: option.node,
              label: option.label,
              active: textTransform === option.key,
            })),
            { key: "normal", node: "A", label: "upright", active: fontStyle === "normal" },
            { key: "italic", node: "A", label: "italic", active: fontStyle === "italic" },
          ]}
          spacerAfterIndex={2}
          onChange={(next) => {
            if (next === "normal" || next === "italic") {
              onSetTextFieldStyle(field.key, "font-style", next);
            } else {
              onSetTextFieldStyle(field.key, "text-transform", next);
            }
          }}
        />
      )}
      <PromotableControl
        channel={{ kind: "style", prop: "color" }}
        enabled={field.source === "self"}
      >
        {({ value, onCommit }) => (
          <ColorField
            label={t("Color")}
            value={value ?? getTextFieldColor(field, styles)}
            onPreview={(next) => onPreviewTextFieldStyle?.(field.key, "color", next)}
            onCommit={onCommit ?? ((next) => onSetTextFieldStyle(field.key, "color", next))}
          />
        )}
      </PromotableControl>
    </>
  );
}

export function FlatTextSection({
  element,
  styles,
  fontAssets,
  onImportFonts,
  onSetText,
  onSetTextFieldStyle,
  onPreviewTextFieldStyle,
  onSetHtmlAttribute,
  onAddTextField,
  onRemoveTextField,
}: {
  element: DomEditSelection;
  styles: Record<string, string>;
  fontAssets: ImportedFontAsset[];
} & Pick<
  PropertyPanelProps,
  | "onImportFonts"
  | "onSetText"
  | "onSetTextFieldStyle"
  | "onPreviewTextFieldStyle"
  | "onAddTextField"
  | "onRemoveTextField"
> & { onSetHtmlAttribute?: PropertyPanelProps["onSetHtmlAttribute"] }) {
  const { t } = useI18n();
  const mvp = useMvpEditor();
  const track = useTrackDesignInput();
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(
    element.textFields[0]?.key ?? null,
  );
  // Armed by the add handler so the newly added field mounts focused. State, not
  // a ref cleared during render: Strict Mode renders twice, so the first pass
  // would eat the marker and the second would mount the field unfocused. Nothing
  // clears it on read either — `autoFocus` is a mount-only DOM prop and the
  // editor is keyed on the field, so it can only fire once per added field.
  const [autoFocusFieldKey, setAutoFocusFieldKey] = useState<string | null>(null);

  useEffect(() => {
    const nextFields = element.textFields;
    setActiveFieldKey((current) => {
      if (current && nextFields.some((field) => field.key === current)) return current;
      return nextFields[0]?.key ?? null;
    });
  }, [element.id, element.selector, element.textFields]);

  if (!isTextEditableSelection(element)) return null;
  const textFields = element.textFields;
  const activeField = textFields.find((field) => field.key === activeFieldKey) ?? textFields[0];
  if (!activeField) return null;

  const autoFocusActiveField = autoFocusFieldKey === activeField.key;
  const fieldsClassName = mvp ? "flex flex-col gap-2.5" : "space-y-2.5";

  if (textFields.length > 1) {
    return (
      <div className={fieldsClassName}>
        <FlatTextLayerList
          fields={textFields}
          activeFieldKey={activeField.key}
          styles={styles}
          onSelect={(fieldKey) => {
            setAutoFocusFieldKey(null);
            setActiveFieldKey(fieldKey);
          }}
          onAdd={() =>
            void Promise.resolve(onAddTextField(activeField.key)).then((nextKey) => {
              if (!nextKey) return;
              setAutoFocusFieldKey(nextKey);
              setActiveFieldKey(nextKey);
            })
          }
          onRemove={onRemoveTextField}
        />
        <FlatTextFieldEditor
          key={activeField.key}
          field={activeField}
          styles={styles}
          fontAssets={fontAssets}
          previewDocument={element.element?.ownerDocument}
          onImportFonts={onImportFonts}
          onSetText={onSetText}
          onSetTextFieldStyle={onSetTextFieldStyle}
          onPreviewTextFieldStyle={onPreviewTextFieldStyle}
          autoFocus={autoFocusActiveField}
        />
      </div>
    );
  }

  return (
    <div className={fieldsClassName}>
      <FlatTextFieldEditor
        field={activeField}
        styles={styles}
        fontAssets={fontAssets}
        previewDocument={element.element?.ownerDocument}
        onImportFonts={onImportFonts}
        onSetText={onSetText}
        onSetTextFieldStyle={onSetTextFieldStyle}
        onPreviewTextFieldStyle={onPreviewTextFieldStyle}
        onSetHtmlAttribute={activeField.source === "self" ? onSetHtmlAttribute : undefined}
      />
      {!mvp && <Button variant="plain"
        type="button"
        onClick={() => {
          track("button", "Add text field");
          void Promise.resolve(onAddTextField(activeField.key)).then((nextKey) => {
            if (!nextKey) return;
            setAutoFocusFieldKey(nextKey);
            setActiveFieldKey(nextKey);
          });
        }}
        className="mt-0.5 flex items-center gap-[5px] text-[10px] text-panel-text-4 hover:text-panel-text-2"
      >
        <Plus size={10} />
        {t("Add text field")}</Button>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Multi-field layer list (design_handoff_studio_inspector, #10a —     */
/*  no mock exists for this row; layout originated by this plan,        */
/*  following the "left-rule nested content" convention established     */
/*  by Text's own content block, Motion's effect cards, and Media's     */
/*  cutout block. Flag for design review.)                              */
/* ------------------------------------------------------------------ */

export function FlatTextLayerList({
  fields,
  activeFieldKey,
  styles,
  onSelect,
  onAdd,
  onRemove,
}: {
  fields: DomEditSelection["textFields"];
  activeFieldKey: string;
  styles: Record<string, string>;
  onSelect: (fieldKey: string) => void;
  onAdd: () => void;
  onRemove: (fieldKey: string) => void;
}) {
  const { t } = useI18n();
  const mvp = useMvpEditor();
  const track = useTrackDesignInput();
  return (
    <div className="mb-2 border-l-2 border-panel-border-input py-0.5 pl-[10px]">
      <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-panel-text-5">
        {t("Text layers")}</div>
      <div className="space-y-1">
        {fields.map((field, index) => {
          const active = field.key === activeFieldKey;
          return (
            <div
              key={field.key}
              data-flat-text-layer-row="true"
              data-active={active}
              onClick={() => onSelect(field.key)}
              className={`flex min-h-[26px] cursor-pointer items-center gap-2 rounded px-1 ${
                active ? "bg-panel-accent/10" : "hover:bg-panel-hover"
              }`}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-xs"
                style={{ backgroundColor: getTextFieldColor(field, styles) }}
              />
              <span className="min-w-0 flex-1 truncate text-[11px] text-panel-text-1">
                {formatTextFieldPreview(field.value) || t("Text {index}", { index: index + 1 })}
              </span>
              <span className="shrink-0 font-mono text-[9px] text-panel-text-4">
                {field.tagName}
              </span>
              {fields.length > 1 && (
                <IconButton variant="plain"
                  type="button"
                  data-flat-text-layer-remove="true"
                  aria-label={t("Remove text field")}
                  onClick={(e) => {
                    e.stopPropagation();
                    track("button", "Remove text field");
                    onRemove(field.key);
                  }}
                  className="shrink-0 text-panel-text-4 hover:text-panel-text-1"
                  icon={<X size={10} />}
                />
              )}
            </div>
          );
        })}
      </div>
      {!mvp && <Button variant="plain"
        type="button"
        data-flat-text-layer-add="true"
        onClick={() => {
          track("button", "Add text field");
          onAdd();
        }}
        className="mt-1 flex items-center gap-[5px] text-[10px] text-panel-text-4 hover:text-panel-text-2"
      >
        <Plus size={10} />
        {t("Add text field")}</Button>}
    </div>
  );
}
