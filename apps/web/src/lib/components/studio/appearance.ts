import type { Appearance } from "@open-motion/motion/contract";
import { attr, text as copyText, disclosure, field, m, note, numberField, slot } from "../../locale/index.js";
export class AppearanceFields {
  readonly element: HTMLElement;
  readonly textElement: HTMLElement;
  private fields = new Map<"x" | "y" | "rotation" | "opacity", ReturnType<typeof numberField>>();
  private textFields = new Map<"align" | "decoration", HTMLSelectElement>();
  private touched = new Set<keyof Appearance>();
  private color: HTMLInputElement;
  constructor(document: Document, changed: () => void) {
    const view = disclosure(document, m("外观与静态位移")),
      grid = slot(document, "pair");
    this.element = view.element;
    this.textElement = slot(document, "pair");
    for (const [key, label, entries] of [
      [
        "align",
        m("文本对齐"),
        [
          ["start", m("逻辑起点")],
          ["end", m("逻辑终点")],
          ["left", m("左对齐")],
          ["center", m("居中")],
          ["right", m("右对齐")],
        ],
      ],
      [
        "decoration",
        m("文本装饰"),
        [
          ["none", m("无下划线")],
          ["underline", m("下划线")],
        ],
      ],
    ] as const) {
      const select = document.createElement("select");
      attr(select, "aria-label", label);
      for (const [value, text] of [["", m("继承 / 源码定义")], ...entries] as const) {
        const option = document.createElement("option");
        option.value = value ?? "";
        copyText(option, text ?? "");
        select.append(option);
      }
      select.onchange = () => {
        this.touched.add(key);
        changed();
      };
      this.textFields.set(key, select);
      this.textElement.append(field(document, label, select));
    }
    for (const [key, label, unit, min, max] of [
      ["x", m("偏移 X"), "px", -65536, 65536],
      ["y", m("偏移 Y"), "px", -65536, 65536],
      ["rotation", m("旋转"), "°", -36000, 36000],
      ["opacity", m("不透明度"), "", 0, 1],
    ] as const) {
      const control = numberField(document, {
        label,
        unit,
        min,
        max,
        optional: true,
        change: () => {
          this.touched.add(key);
          changed();
        },
      });
      attr(control.input, "placeholder", m("未指定"));
      this.fields.set(key, control);
      grid.append(field(document, label, control.element));
    }
    this.color = document.createElement("input");
    attr(this.color, "aria-label", m("文字颜色"));
    attr(this.color, "placeholder", "#RRGGBB");
    this.color.oninput = () => {
      this.touched.add("color");
      changed();
    };
    view.body.append(
      note(document, m("位移与旋转是静态基值；关键帧偏移独立叠加。未修改项保留原生继承与表达式。")),
      grid,
      field(document, m("文字颜色"), this.color),
    );
  }
  read(): Appearance {
    const value: Appearance = {};
    for (const [key, control] of this.fields) if (this.touched.has(key)) value[key] = control.input.valueAsNumber;
    if (this.touched.has("color")) value.color = this.color.value;
    for (const [key, select] of this.textFields)
      if (this.touched.has(key)) Object.assign(value, { [key]: select.value || null });
    return value;
  }
  validate() {
    for (const [key, control] of this.fields)
      if (this.touched.has(key)) {
        control.validate();
        if (!control.input.value) throw new Error(`${control.input.getAttribute("aria-label")}请输入有效数值`);
      }
    if (this.touched.has("color") && !/^#[0-9a-fA-F]{6}$/.test(this.color.value))
      throw new Error("文字颜色需要 #RRGGBB");
  }
  block(value: boolean, text = false) {
    for (const control of this.fields.values()) control.readonly(value);
    this.color.readOnly = value;
    this.textElement.hidden = !text;
    for (const select of this.textFields.values()) select.disabled = value || !text;
  }
  update(value: Appearance, pending: Appearance | undefined, reset: boolean) {
    if (reset || !pending) this.touched.clear();
    for (const [key, select] of this.textFields)
      select.value = (pending && Object.hasOwn(pending, key) ? pending[key] : value[key]) ?? "";
    for (const [key, control] of this.fields) control.value(pending?.[key] ?? value[key], reset);
    if (reset || this.color.ownerDocument.activeElement !== this.color)
      this.color.value = pending?.color ?? value.color ?? "";
  }
}
