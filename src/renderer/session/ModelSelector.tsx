import type { ModelOption } from "../../shared/protocol";
import { ControlBox } from "../ui/ControlBox";
import { ComposerMenu } from "./ComposerMenu";

export type ModelSelectorVariant = "field" | "pill";

function modelLabel(model: ModelOption): string {
  return model.label || model.id;
}

export function ModelSelector({
  models,
  current,
  onSelect,
  variant = "field",
  className = "",
}: {
  models: ModelOption[];
  current: string;
  onSelect: (model: string) => void;
  variant?: ModelSelectorVariant;
  className?: string;
}) {
  const available = models.filter((model) => model.available);
  const known = available.some((model) => model.id === current);
  const value = known ? current : (available[0]?.id ?? "");

  if (available.length === 0) {
    if (variant === "pill") {
      return (
        <ControlBox
          as="static"
          className={`ctrl-box ctrl-box-empty ${className}`.trim()}
          ariaLabel="Model"
        >
          No models
        </ControlBox>
      );
    }
    return (
      <select className={`model-selector ${className}`.trim()} aria-label="Model" disabled value="">
        <option value="">No models available</option>
      </select>
    );
  }

  if (variant === "pill") {
    return <ComposerMenu
      className={className}
      title="Model"
      ariaLabel="Model"
      value={value}
      valueLabel={modelLabel(available.find((model) => model.id === value) ?? available[0])}
      options={available.map((model) => ({ value: model.id, label: modelLabel(model) }))}
      onChange={onSelect}
      leading={<span className="ctrl-box-dot" aria-hidden />}
    />;
  }

  return (
    <select
      className={`model-selector ${className}`.trim()}
      aria-label="Model"
      value={value}
      onChange={(event) => onSelect(event.target.value)}
    >
      {available.map((model) => (
        <option key={model.id} value={model.id}>
          {`${modelLabel(model)} · ${model.provider}`}
        </option>
      ))}
    </select>
  );
}
