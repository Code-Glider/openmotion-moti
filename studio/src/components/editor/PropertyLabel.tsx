import { Tooltip } from "../ui/Tooltip";
import { useTextOverflow } from "../ui/useTextOverflow";

/** Property names share the available row width without displacing controls. */
export function PropertyLabel({ label, className = "", singleLine = false, ...props }: {
  label: string;
  className?: string;
  singleLine?: boolean;
  "data-flat-toggle-label"?: string;
}) {
  const { ref, overflowing, measure } = useTextOverflow(label);
  return (
    <Tooltip label={label} wrap disabled={!overflowing}>
      <span {...props} tabIndex={overflowing ? 0 : undefined} onPointerEnter={measure} onFocus={measure} className={`min-w-0 flex-1 cursor-default text-[11px] ${className}`}>
        <span ref={ref} className={singleLine ? "block truncate" : "line-clamp-2 [overflow-wrap:anywhere]"}>{label}</span>
      </span>
    </Tooltip>
  );
}
