// Pure rules shared by Edge Functions and the browser. No React, SDK, I/O or AI.
export const serviceKindOptions = ["Adjustment", "Replacement", "Paid Extra"]
  .map((value) => ({ value, label: value }));
export const multipleServiceWorkType = "Multiple work types";
export const serviceWorkTypeOptions = [
  "Exterior Frames",
  "Doors",
  "Moldings",
  "Hardware",
  "Weatherstripping",
  "Shelving",
  multipleServiceWorkType,
].map((value) => ({ value, label: value }));
export const serviceTaskOptions = [
  {
    value: "GENERAL_FIX",
    label: "General fix",
    durationMinutes: 30,
    crewSize: 1,
  },
  {
    value: "EXTERIOR_DOOR_REPLACEMENT",
    label: "Exterior door replacement",
    durationMinutes: 120,
    crewSize: 1,
  },
  {
    value: "EXTERIOR_FRAME_REPLACEMENT",
    label: "Exterior frame replacement",
    durationMinutes: 120,
    crewSize: 1,
  },
  {
    value: "SHUTTER_REPLACEMENT",
    label: "Shutter replacement",
    durationMinutes: 120,
    crewSize: 2,
  },
  {
    value: "SHELVING_REPLACEMENT",
    label: "Shelving replacement",
    durationMinutes: 60,
    crewSize: 1,
  },
];

/** @param {unknown} value */
const text = (value) => typeof value === "string" ? value.trim() : "";
/** @param {unknown} value */
const key = (value) => text(value).replaceAll("_", " ").toLowerCase();
/** @param {unknown} value @param {{value: string}[]} options */
const catalogValue = (value, options) =>
  options.find((option) => key(option.value) === key(value))?.value ?? "";
/** @param {unknown} value */
export const hasPlanningValue = (value) =>
  value !== null && value !== undefined && value !== "" &&
  !(typeof value === "string" && !value.trim());
/** @param {unknown} value */
export const getServiceTask = (value) =>
  serviceTaskOptions.find((option) => option.value === value);
/** @param {number} itemCount */
export function calculateGeneralFixDuration(itemCount) {
  const count = Math.max(0, Math.floor(Number(itemCount) || 0));
  return count >= 10 ? 60 : count >= 7 ? 45 : 30;
}
/** @param {unknown} taskValue @param {number} itemCount */
export function planningForTask(taskValue, itemCount) {
  const task = getServiceTask(taskValue);
  return {
    estimatedDurationMinutes: task
      ? task.value === "GENERAL_FIX"
        ? calculateGeneralFixDuration(itemCount)
        : task.durationMinutes
      : null,
    crewSize: task?.crewSize ?? null,
  };
}

/** @typedef {{description?: string|null, requestedAction?: string|null, location?: string|null, sourceCategory?: string|null, assignedToValtrim?: boolean|null, suggestedServiceKind?: string|null, suggestedWorkType?: string|null, suggestedServiceTask?: string|null}} PlanningItem */
/** @param {PlanningItem} item */
export function inferServiceKind(item) {
  const suggested = catalogValue(item.suggestedServiceKind, serviceKindOptions);
  if (suggested) return { value: suggested, inferred: false };
  const source = `${text(item.requestedAction)} ${text(item.description)}`
    .toLowerCase();
  if (/\b(paid extra|extra paid|upgrade)\b/u.test(source)) {
    return { value: "Paid Extra", inferred: true };
  }
  if (/\b(replace|replacement)\b/u.test(source)) {
    return { value: "Replacement", inferred: true };
  }
  if (
    /\b(repair|adjust|fix|stuck|gap|not working|doesn'?t|does not|lock|latch)\b/u
      .test(source)
  ) return { value: "Adjustment", inferred: true };
  return { value: "", inferred: false };
}
/** @param {PlanningItem} item */
export function inferWorkType(item) {
  const suggested = catalogValue(
    item.suggestedWorkType,
    serviceWorkTypeOptions,
  );
  if (suggested) return { value: suggested, inferred: false };
  const source = `${text(item.sourceCategory)} ${text(item.description)} ${
    text(item.location)
  }`.toLowerCase();
  if (/\b(weather|weatherstrip|gap|light through|bugs?)\b/u.test(source)) {
    return { value: "Weatherstripping", inferred: true };
  }
  if (/\b(shelf|shelving)\b/u.test(source)) {
    return { value: "Shelving", inferred: true };
  }
  if (/\b(exterior frame|doorframe|door frame)\b/u.test(source)) {
    return { value: "Exterior Frames", inferred: true };
  }
  if (
    /\bdoor\b/u.test(source) &&
    /\b(adjust|adjustment|close|closing|stuck|bind|binding|rub|rubbing)\b/u
      .test(source)
  ) return { value: "Doors", inferred: true };
  if (
    /\b(hardware|hinge|lock|latch|handles?|knobs?|pulls?|strike plate)\b/u.test(
      source,
    )
  ) return { value: "Hardware", inferred: true };
  if (/\bdoor\b/u.test(source)) return { value: "Doors", inferred: true };
  if (/\b(molding|moulding|trim)\b/u.test(source)) {
    return { value: "Moldings", inferred: true };
  }
  return { value: "", inferred: false };
}
/** @param {PlanningItem} item @param {string} kind @param {string} workType */
export function inferServiceTask(item, kind, workType) {
  const suggested = catalogValue(item.suggestedServiceTask, serviceTaskOptions);
  if (suggested) return { value: suggested, inferred: false };
  if (kind === "Replacement") {
    const replacements = {
      "Exterior Frames": "EXTERIOR_FRAME_REPLACEMENT",
      "Doors": "EXTERIOR_DOOR_REPLACEMENT",
      "Shelving": "SHELVING_REPLACEMENT",
    };
    const task = replacements[workType];
    if (task) return { value: task, inferred: true };
  }
  return {
    value: text(item.description) || text(item.requestedAction)
      ? "GENERAL_FIX"
      : "",
    inferred: true,
  };
}

/**
 * Classify the entire included scope, rather than copying the first item.
 * blockedFields preserves explicit disagreements already found by the merger.
 * @param {PlanningItem[]} items
 * @param {{blockedFields?: string[]}} options
 */
export function suggestRequestPlanning(items, { blockedFields = [] } = {}) {
  const included = items.filter((item) =>
    item.assignedToValtrim !== false &&
    (text(item.description) || text(item.requestedAction))
  );
  const blocked = new Set(blockedFields);
  const empty = () => ({ value: "", inferred: false });
  const rows = included.map((item) => {
    const kind = blocked.has("serviceKind") ? empty() : inferServiceKind(item);
    const type = blocked.has("workType") ? empty() : inferWorkType(item);
    const explicitTask = catalogValue(
      item.suggestedServiceTask,
      serviceTaskOptions,
    );
    const task = blocked.has("serviceTask") ||
        !explicitTask && (blocked.has("serviceKind") || blocked.has("workType"))
      ? empty()
      : inferServiceTask(item, kind.value, type.value);
    return { kind, type, task };
  });
  const warnings = [];
  /** @param {{value:string,inferred:boolean}[]} proposals */
  const distinct = (
    proposals,
  ) => [...new Set(proposals.map((p) => p.value).filter(Boolean))];
  /** @param {{value:string,inferred:boolean}[]} proposals */
  const common = (proposals) =>
    proposals.length && proposals.every((p) => p.value) &&
      distinct(proposals).length === 1
      ? proposals[0].value
      : "";
  const kinds = rows.map((row) => row.kind),
    types = rows.map((row) => row.type),
    tasks = rows.map((row) => row.task);
  const workTypes = distinct(types);
  const serviceKind = common(kinds);
  const workType = workTypes.length > 1
    ? multipleServiceWorkType
    : common(types);
  const serviceTask = common(tasks);
  if (distinct(kinds).length > 1) {
    warnings.push(
      "Multiple service classifications were detected. Review Service kind, Work type, and Service task for the complete request.",
    );
  }
  if (workTypes.length > 1) {
    warnings.push(
      "Multiple work types were detected. Work type was set to Multiple work types; review the included items.",
    );
  }
  if (distinct(tasks).length > 1) {
    warnings.push(
      "Multiple service tasks were detected. Service task, duration and crew remain pending review.",
    );
  }
  for (
    const [label, value, proposals]
      of /** @type {[string,string,{value:string,inferred:boolean}[]][]} */ ([
        ["Service kind", serviceKind, kinds],
        ["Work type", workType, types],
        ["Service task", serviceTask, tasks],
      ])
  ) {
    if (value && proposals.some((p) => p.inferred)) {
      warnings.push(
        `${label} inferred as ${getServiceTask(value)?.label ?? value}.`,
      );
    }
  }
  const planning = planningForTask(serviceTask, included.length);
  if (serviceTask) {
    warnings.push(
      "Duration and crew are catalog suggestions; confirm them during review.",
    );
  }
  return { serviceKind, workType, serviceTask, ...planning, warnings };
}
