import { Input, Textarea } from "@/components/ui/field";
type Json = null | string | number | boolean | Json[] | { [key: string]: Json };
const label = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
export function BibleDraftContent({
  value,
  name = "Draft",
  onChange,
}: {
  value: Json;
  name?: string;
  onChange?: (value: Json) => void;
}) {
  if (Array.isArray(value))
    return (
      <div className="grid gap-3">
        {value.length ? (
          value.map((item, index) => (
            <section key={index} className="rounded border border-border p-3">
              <h4 className="mb-2 text-sm font-semibold">
                {label(name)} {index + 1}
              </h4>
              <BibleDraftContent
                value={item}
                name={`${name} ${index + 1}`}
                onChange={
                  onChange
                    ? (next) => onChange(value.map((old, i) => (i === index ? next : old)))
                    : undefined
                }
              />
            </section>
          ))
        ) : (
          <p className="text-sm text-muted">None declared</p>
        )}
      </div>
    );
  if (value && typeof value === "object")
    return (
      <div className="grid gap-4">
        {Object.entries(value).map(([key, child]) => (
          <div key={key}>
            <h4 className="mb-1 text-sm font-semibold capitalize">{label(key)}</h4>
            <BibleDraftContent
              name={label(key)}
              value={child}
              onChange={onChange ? (next) => onChange({ ...value, [key]: next }) : undefined}
            />
          </div>
        ))}
      </div>
    );
  if (onChange && typeof value === "string")
    return (
      <Textarea
        aria-label={name}
        className="min-h-28"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  if (onChange && typeof value === "number")
    return (
      <Input
        type="number"
        aria-label={name}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    );
  return (
    <p
      className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${name === "fountain" ? "font-mono" : "text-muted"}`}
    >
      {value === null ? "Not specified" : String(value)}
    </p>
  );
}
