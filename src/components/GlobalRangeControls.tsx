import { useRef } from "react";

import { PRACTICE_GROUPS } from "../domain/notes";
import type { AppSettings, PracticeGroupId, StaffNotationMode } from "../domain/types";

interface GlobalRangeControlsProps {
  disabled?: boolean;
  settings: AppSettings;
  onSettingsSaved: (settings: AppSettings) => void | Promise<void>;
}

function orderGroupIds(groupIds: PracticeGroupId[]): PracticeGroupId[] {
  const selected = new Set(groupIds);
  return PRACTICE_GROUPS.map((group) => group.id).filter((groupId) => selected.has(groupId));
}

export function GlobalRangeControls({ disabled = false, settings, onSettingsSaved }: GlobalRangeControlsProps): JSX.Element {
  const pointerToggleRef = useRef(false);

  function markPointerToggle(): void {
    pointerToggleRef.current = true;
    window.setTimeout(() => {
      pointerToggleRef.current = false;
    }, 1000);
  }

  function blurAfterPointerToggle(input: HTMLInputElement): void {
    if (!pointerToggleRef.current) {
      return;
    }
    pointerToggleRef.current = false;
    window.setTimeout(() => {
      if (document.activeElement === input) {
        input.blur();
      }
    }, 0);
  }

  function save(nextSettings: AppSettings): void {
    void onSettingsSaved(nextSettings);
  }

  function toggleGroup(groupId: PracticeGroupId, checked: boolean): void {
    const nextGroupIds = checked
      ? orderGroupIds([...settings.enabledGroupIds, groupId])
      : settings.enabledGroupIds.filter((id) => id !== groupId);
    save({ ...settings, enabledGroupIds: nextGroupIds });
  }

  function selectStaffNotationMode(staffNotationMode: StaffNotationMode): void {
    save({ ...settings, staffNotationMode });
  }

  function toggleInterStaffLedger(checked: boolean): void {
    save({ ...settings, includeInterStaffLedgerSpellings: checked });
  }

  return (
    <div className={disabled ? "global-range-controls global-range-controls-locked" : "global-range-controls"} aria-label="全局范围">
      <div className="global-range-groups">
        {PRACTICE_GROUPS.map((group) => {
          const checked = settings.enabledGroupIds.includes(group.id);
          return (
            <label
              className={checked ? "choice choice-active global-range-group-choice" : "choice global-range-group-choice"}
              key={group.id}
              onPointerDown={markPointerToggle}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(event) => {
                  toggleGroup(group.id, event.target.checked);
                  blurAfterPointerToggle(event.currentTarget);
                }}
              />
              <span>{group.label}</span>
            </label>
          );
        })}
      </div>
      <span className="global-range-divider" aria-hidden="true" />
      <div
        className={
          settings.staffNotationMode === "grand"
            ? "global-range-staff-section global-range-staff-section-grand"
            : "global-range-staff-section"
        }
      >
        <div className="segmented global-range-staffs" aria-label="谱表选择">
          {([
            ["treble-only", "高音谱表"],
            ["bass-only", "低音谱表"],
            ["grand", "大谱表"],
          ] as const).map(([staffNotationMode, label]) => {
            return (
              <button
                aria-pressed={settings.staffNotationMode === staffNotationMode}
                className={settings.staffNotationMode === staffNotationMode ? "active" : ""}
                disabled={disabled}
                key={staffNotationMode}
                type="button"
                onClick={() => selectStaffNotationMode(staffNotationMode)}
              >
                {label}
              </button>
            );
          })}
        </div>
        {settings.staffNotationMode === "grand" ? (
          <label
            className="global-range-ledger-choice"
            onPointerDown={markPointerToggle}
          >
            <input
              checked={settings.includeInterStaffLedgerSpellings}
              disabled={disabled}
              type="checkbox"
              onChange={(event) => {
                toggleInterStaffLedger(event.target.checked);
                blurAfterPointerToggle(event.currentTarget);
              }}
            />
            <span>谱表间加线</span>
            <small>E3–A4 同时练习两种谱号</small>
          </label>
        ) : null}
      </div>
    </div>
  );
}
