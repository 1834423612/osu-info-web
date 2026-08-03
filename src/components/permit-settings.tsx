"use client";

import { Icon } from "@iconify/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { CampusParkingMap } from "@/components/map/campus-parking-map";
import {
  ACCESSIBLE_PERMIT_GUIDANCE,
  estimateVisitorParkingCost,
  getCurrentAccessSummary,
  getIdentityDefinition,
  getPermitByCode,
  getPermitPlanningNotice,
  inferIdentityForPermitSelection,
  isPermitCode,
  isPermitEligibleForIdentity,
  OFFICIAL_PARKING_URLS,
  PARKING_PERMITS,
  PARKING_IDENTITIES,
  PERMIT_GROUPS,
  PERMIT_YEAR_2026_27,
  VISITOR_PARKING_RATES_2026_27,
  type PermitAudience,
  type UserParkingIdentity,
} from "@/data/permits";
import { usePermitAreas } from "@/hooks/use-permit-areas";
import {
  getPermitMapPeriods,
  PERMIT_MAP_ALL_ZONES,
  type PermitMapPeriodId,
} from "@/lib/permit-map";
import { cn, formatNumber } from "@/lib/utils";

const audienceIcon: Record<PermitAudience, string> = {
  "faculty-ap": "solar:square-academic-cap-2-bold-duotone",
  staff: "solar:case-round-bold-duotone",
  student: "solar:backpack-bold-duotone",
  other: "solar:users-group-rounded-bold-duotone",
};

const identityIcon: Record<UserParkingIdentity, string> = {
  ...audienceIcon,
  "medical-center": "solar:medical-kit-bold-duotone",
  visitor: "solar:ticket-sale-bold-duotone",
};

export function getSelectedPermitLabel(code: string) {
  if (code === "visitor") return "访客 / 按小时停车";
  if (!isPermitCode(code)) return "尚未设置停车证";
  const permit = PARKING_PERMITS.find((item) => item.code === code);
  return permit ? `${permit.officialCode} · ${permit.nameZh}` : "尚未设置停车证";
}

function OvernightCostPlanner() {
  const [hours, setHours] = useState(2);
  const estimate = estimateVisitorParkingCost(hours);

  return (
    <section className="overnight-cost-planner">
      <header>
        <span>
          <Icon icon="solar:moon-stars-bold-duotone" />
        </span>
        <div>
          <small>没有正式 overnight 权限时</small>
          <strong>按官方访客费率估算</strong>
        </div>
        <div className="overnight-cost-planner__duration" aria-label="停车时长">
          {[2, 4, 8].map((option) => (
            <button
              type="button"
              key={option}
              className={hours === option ? "is-active" : undefined}
              onClick={() => setHours(option)}
              aria-pressed={hours === option}
            >
              {option}h
            </button>
          ))}
        </div>
      </header>
      <div className="overnight-cost-planner__rates">
        <span>
          <small>按小时地面位</small>
          <strong>${estimate.surfaceUsd.toFixed(2)}</strong>
          <i>$3 / 小时</i>
        </span>
        <span>
          <small>Academic 车库</small>
          <strong>${estimate.academicGarageUsd.toFixed(2)}</strong>
          <i>日上限 $20</i>
        </span>
        <span>
          <small>Medical 车库</small>
          <strong>${estimate.medicalCenterGarageUsd.toFixed(2)}</strong>
          <i>日上限 $15.75</i>
        </span>
      </div>
      <p>
        标准工作日 3–5 a.m. 为 2 小时；仅限明确允许 overnight
        的按小时位置或 24/7 访客车库。跨午夜、活动和验证优惠以 ParkMobile/
        入口为准。
      </p>
      <a
        href={VISITOR_PARKING_RATES_2026_27.sourceUrl}
        target="_blank"
        rel="noreferrer"
      >
        核对官方费率
        <Icon icon="solar:arrow-right-up-linear" />
      </a>
    </section>
  );
}

export function PermitSettings({
  open,
  selectedCode,
  selectedIdentity,
  now,
  onSave,
  onClose,
}: {
  open: boolean;
  selectedCode: string;
  selectedIdentity?: UserParkingIdentity;
  now: number;
  onSave: (code: string, identity: UserParkingIdentity) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(selectedCode);
  const [draftIdentity, setDraftIdentity] = useState<UserParkingIdentity>(
    selectedIdentity ?? inferIdentityForPermitSelection(selectedCode),
  );
  const [previewPeriod, setPreviewPeriod] =
    useState<PermitMapPeriodId>("current");
  const modalRef = useRef<HTMLElement>(null);
  const selectDraft = (code: string) => {
    setDraft(code);
    if (code === "visitor") setDraftIdentity("visitor");
    setPreviewPeriod("current");
  };
  const selectIdentity = (identity: UserParkingIdentity) => {
    setDraftIdentity(identity);
    setPreviewPeriod("current");
    if (identity === "visitor") {
      setDraft("visitor");
      return;
    }
    if (
      draft === "visitor" ||
      (isPermitCode(draft) &&
        !isPermitEligibleForIdentity(
          getPermitByCode(draft),
          identity,
        ))
    ) {
      setDraft("none");
    }
  };

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      setDraft(selectedCode);
      setDraftIdentity(
        selectedIdentity ?? inferIdentityForPermitSelection(selectedCode),
      );
      setPreviewPeriod("current");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, selectedCode, selectedIdentity]);

  useEffect(() => {
    if (!open) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    const focusFrame = window.requestAnimationFrame(() => {
      const preferred = modalRef.current?.querySelector<HTMLElement>(
        ".permit-choice.is-active",
      );
      const fallback = modalRef.current?.querySelector<HTMLElement>(
        'button[aria-label="关闭"]',
      );
      (preferred ?? fallback)?.focus({ preventScroll: true });
    });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !modalRef.current) return;
      const focusable = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1) ?? first;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKey);
      if (previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [onClose, open]);

  const permit = useMemo(
    () => (isPermitCode(draft) ? PARKING_PERMITS.find((item) => item.code === draft) : undefined),
    [draft],
  );
  const visiblePermitGroups = useMemo(() => {
    const audiences = new Set(
      getIdentityDefinition(draftIdentity).permitAudiences,
    );
    return PERMIT_GROUPS.filter((group) => audiences.has(group.audience));
  }, [draftIdentity]);
  const summary = useMemo(
    () =>
      isPermitCode(draft)
        ? getCurrentAccessSummary(draft, now)
        : undefined,
    [draft, now],
  );
  const planningNotice = useMemo(
    () =>
      isPermitCode(draft) ? getPermitPlanningNotice(draft, now) : undefined,
    [draft, now],
  );
  const previewPeriods = useMemo(
    () => (isPermitCode(draft) ? getPermitMapPeriods(draft, now) : []),
    [draft, now],
  );
  const activePreviewPeriod =
    previewPeriods.find((period) => period.id === previewPeriod) ??
    previewPeriods[0];
  const previewZones = activePreviewPeriod?.zones ?? [];
  const previewAreas = usePermitAreas(
    summary ? PERMIT_MAP_ALL_ZONES : [],
    open && Boolean(summary),
  );
  const previewHasFeatures = previewAreas.data.features.length > 0;

  if (!open) return null;

  return (
    <div className="modal-layer">
      <button
        type="button"
        className="modal-backdrop"
        onClick={onClose}
        aria-label="关闭停车证设置"
      />
      <section
        ref={modalRef}
        className="permit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="permit-modal-title"
      >
        <header className="permit-modal__header">
          <div>
            <span className="eyebrow">LOCAL PREFERENCE</span>
            <h2 id="permit-modal-title">选择你的停车证</h2>
            <p>只保存在当前浏览器，不需要登录，也不会上传车牌或身份信息。</p>
          </div>
          <button
            type="button"
            className="circle-button"
            onClick={onClose}
            aria-label="关闭"
          >
            <Icon icon="solar:close-circle-linear" />
          </button>
        </header>

        <div className="permit-modal__content">
          <aside className="permit-picker">
            <div className="permit-identity-selector" aria-label="你的身份">
              <div>
                <strong>先选择你的身份</strong>
                <small>只用于筛掉明显不适用的停车证</small>
              </div>
              <div role="group" aria-label="停车身份筛选">
                {PARKING_IDENTITIES.map((identity) => (
                  <button
                    type="button"
                    key={identity.code}
                    className={cn(
                      draftIdentity === identity.code && "is-active",
                    )}
                    onClick={() => selectIdentity(identity.code)}
                    aria-pressed={draftIdentity === identity.code}
                    title={identity.descriptionZh}
                  >
                    <Icon icon={identityIcon[identity.code]} />
                    <span>{identity.labelZh}</span>
                  </button>
                ))}
              </div>
              {draftIdentity === "medical-center" && (
                <p>
                  医学中心员工的可购证件仍取决于实际 Faculty/A&amp;P 或 CCS
                  岗位；这里同时显示两组，不推测医院内部指派区域。
                </p>
              )}
            </div>
            <button
              type="button"
              className={cn(
                "permit-choice permit-choice--special",
                draft === "none" && "is-active",
              )}
              onClick={() => selectDraft("none")}
            >
              <span>
                <Icon icon="solar:question-circle-bold-duotone" />
              </span>
              <span>
                <strong>暂不设置</strong>
                <small>仅浏览实时空位</small>
              </span>
              <Icon icon="solar:alt-arrow-right-linear" />
            </button>
            {draftIdentity === "visitor" && <button
              type="button"
              className={cn(
                "permit-choice permit-choice--special",
                draft === "visitor" && "is-active",
              )}
              onClick={() => selectDraft("visitor")}
            >
              <span>
                <Icon icon="solar:ticket-sale-bold-duotone" />
              </span>
              <span>
                <strong>访客 / 患者</strong>
                <small>按小时或访客停车</small>
              </span>
              <Icon icon="solar:alt-arrow-right-linear" />
            </button>}

            {visiblePermitGroups.map((group) => (
              <div className="permit-group" key={group.audience}>
                <div className="permit-group__title">
                  <Icon icon={audienceIcon[group.audience]} />
                  <span>
                    <strong>{group.labelZh}</strong>
                    <small>{group.descriptionZh}</small>
                  </span>
                </div>
                <div>
                  {group.permitCodes.map((code) => {
                    const item = PARKING_PERMITS.find(
                      (candidate) => candidate.code === code,
                    );
                    if (!item) return null;
                    return (
                      <button
                        type="button"
                        key={`${group.audience}-${code}`}
                        className={cn(
                          "permit-choice",
                          draft === code && "is-active",
                        )}
                        onClick={() => selectDraft(code)}
                      >
                        <b>{item.officialCode}</b>
                        <span>
                          <strong>{item.nameZh}</strong>
                          <small>
                            <span>${formatNumber(item.price.annualUsd)} / 年</span>
                            <em>
                              {item.access.overnight.mode === "not-included"
                                ? "工作日夜间需另规划"
                                : "含夜间权限"}
                            </em>
                          </small>
                        </span>
                        <Icon icon="solar:alt-arrow-right-linear" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </aside>

          <div className="permit-detail-workspace">
            <aside
              className="permit-preview"
              aria-label="停车证证区与规则时段地图预览"
            >
              {summary ? (
                <>
                  <CampusParkingMap
                    variant="permit-preview"
                    permitLayer={{
                      areas: previewAreas.data,
                      visible: !previewAreas.error,
                      permitCode: summary.permit.officialCode,
                      zones: PERMIT_MAP_ALL_ZONES,
                      availableZones: previewZones,
                      periods: previewPeriods,
                      selectedPeriod: activePreviewPeriod?.id ?? "current",
                      onSelectedPeriodChange: setPreviewPeriod,
                      loading: previewAreas.loading,
                      error: previewAreas.error,
                    }}
                  />
                  <div
                    className={cn(
                      "permit-preview__status",
                      previewAreas.error && "is-error",
                    )}
                    role="status"
                    aria-live="polite"
                  >
                    {previewAreas.loading ? (
                      <>
                        <Icon icon="solar:refresh-circle-bold-duotone" />
                        正在读取官方 GIS 区域
                      </>
                    ) : previewAreas.error ? (
                      <>
                        <Icon icon="solar:danger-triangle-bold-duotone" />
                        {previewAreas.error}
                      </>
                    ) : previewZones.length === 0 ? (
                      <>
                        <Icon icon="solar:danger-triangle-bold-duotone" />
                        该时段不含通用地面准停区；灰红区域仅供位置对比
                      </>
                    ) : previewHasFeatures ? (
                      <>
                        <Icon icon="solar:map-point-bold-duotone" />
                        {activePreviewPeriod?.isCurrent
                          ? "地图按当前美东时段即时更新"
                          : `正在预览规则时段：${activePreviewPeriod?.labelZh ?? "所选时段"}`}
                      </>
                    ) : (
                      <>
                        <Icon icon="solar:info-circle-bold-duotone" />
                        官方 GIS 暂未返回匹配区域
                      </>
                    )}
                  </div>
                </>
              ) : (
                <div className="permit-preview__empty">
                  <span>
                    <Icon
                      icon={
                        draft === "visitor"
                          ? "solar:ticket-sale-bold-duotone"
                          : draft === "none"
                            ? "solar:map-bold-duotone"
                            : "solar:moon-stars-bold-duotone"
                      }
                    />
                  </span>
                  <strong>
                    {draft === "visitor"
                      ? "访客停车不使用证件区域图层"
                      : draft === "none"
                        ? "选择停车证后预览可用区域"
                        : "当前时段无通用地面区域"}
                  </strong>
                  <p>
                    {draft === "visitor"
                      ? "请以访客车库入口、ParkMobile 标牌和活动日安排为准。"
                      : draft === "none"
                        ? "地图会立即按当前美东时间显示对应的官方停车区域。"
                        : "夜间 3–5 a.m. 权限通常限定于指定车库或楼层，请查看右侧说明与现场标牌。"}
                  </p>
                </div>
              )}
            </aside>

            <main className="permit-detail">
            {draft === "none" && (
              <div className="permit-placeholder">
                <span>
                  <Icon icon="solar:map-bold-duotone" />
                </span>
                <h3>先看看哪里有空位</h3>
                <p>
                  你仍然可以查看全部停车点、实时占用、CABS 和 EV
                  充电信息。设置停车证后会额外显示当前时段的权限提示。
                </p>
              </div>
            )}

            {draft === "visitor" && (
              <div className="permit-detail__inner">
                <span className="permit-code-badge permit-code-badge--visitor">
                  <Icon icon="solar:ticket-sale-bold" />
                  VISITOR
                </span>
                <h3>访客 / 患者停车</h3>
                <p className="permit-detail__lead">
                  优先查看标有“访客停车”的车库。地面 ParkMobile
                  位、医院验证优惠和活动费率各自独立，现场标牌与入口价格为准。
                </p>
                <div className="rule-grid">
                  <div>
                    <span>
                      <Icon icon="solar:buildings-2-bold-duotone" />
                    </span>
                    <strong>访客车库</strong>
                    <p>
                      SAFEAUTO 与 James Outpatient Care
                      以访客/患者为主；其他混合车库会动态开放入口。
                    </p>
                  </div>
                  <div>
                    <span>
                      <Icon icon="solar:calendar-date-bold-duotone" />
                    </span>
                    <strong>活动日</strong>
                    <p>
                      日票、月票通常不能替代活动停车费；大型活动须查看当日地图。
                    </p>
                  </div>
                </div>
                <OvernightCostPlanner />
                <a
                  className="inline-link"
                  href="https://osu.campusparc.com/find-parking/academic-visitor-parking/"
                  target="_blank"
                  rel="noreferrer"
                >
                  查看官方访客停车说明
                  <Icon icon="solar:arrow-right-up-linear" />
                </a>
              </div>
            )}

            {permit && summary && (
              <div className="permit-detail__inner">
                <div className="permit-detail__headline">
                  <span className="permit-code-badge">{permit.officialCode}</span>
                  <span>
                    <small>{permit.nameEn}</small>
                    <h3>{permit.nameZh}</h3>
                  </span>
                </div>
                <p className="permit-detail__lead">{permit.descriptionZh}</p>

                <div className="current-rule">
                  <div>
                    <span className="live-dot" />
                    <small>当前 · 美东时间</small>
                  </div>
                  <strong>{summary.time.labelZh}</strong>
                  <p>{summary.surfaceZh}</p>
                  <p>{summary.garageZh}</p>
                </div>

                {planningNotice && (
                  <div
                    className={cn(
                      "permit-planning-notice",
                      `is-${planningNotice.tone}`,
                    )}
                  >
                    <Icon
                      icon={
                        planningNotice.tone === "night"
                          ? "solar:moon-stars-bold-duotone"
                          : planningNotice.tone === "warning"
                            ? "solar:clock-circle-bold-duotone"
                            : "solar:map-arrow-right-bold-duotone"
                      }
                    />
                    <span>
                      <strong>{planningNotice.titleZh}</strong>
                      <p>{planningNotice.detailZh}</p>
                    </span>
                  </div>
                )}

                {permit.access.overnight.mode === "not-included" && (
                  <OvernightCostPlanner />
                )}

                <dl className="permit-facts">
                  <div>
                    <dt>适用资格</dt>
                    <dd>{permit.eligibilityZh}</dd>
                  </div>
                  <div>
                    <dt>2026–27 价格</dt>
                    <dd>
                      ${formatNumber(permit.price.annualUsd)} / 年
                      <small>
                        ${permit.price.monthlyUsd.toFixed(2)} / 月
                      </small>
                    </dd>
                  </div>
                  <div>
                    <dt>车库权限</dt>
                    <dd>{permit.access.garage.detailZh}</dd>
                  </div>
                  <div>
                    <dt>夜间 3–5 a.m.</dt>
                    <dd>{permit.access.overnight.detailZh}</dd>
                  </div>
                </dl>

                {!!permit.notesZh?.length && (
                  <div className="permit-notes">
                    {permit.notesZh.map((note) => (
                      <p key={note}>
                        <Icon icon="solar:info-circle-linear" />
                        {note}
                      </p>
                    ))}
                  </div>
                )}

                <div className="permit-detail__links">
                  <a
                    href={permit.officialUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    官方证件详情
                    <Icon icon="solar:arrow-right-up-linear" />
                  </a>
                  <a
                    href={OFFICIAL_PARKING_URLS.surfaceAccess}
                    target="_blank"
                    rel="noreferrer"
                  >
                    地面区域表
                    <Icon icon="solar:arrow-right-up-linear" />
                  </a>
                  <a
                    href={OFFICIAL_PARKING_URLS.garageAccess}
                    target="_blank"
                    rel="noreferrer"
                  >
                    车库权限表
                    <Icon icon="solar:arrow-right-up-linear" />
                  </a>
                </div>
              </div>
            )}

            <div className="ada-note">
              <Icon icon="solar:accessibility-bold-duotone" />
              <span>
                <strong>{ACCESSIBLE_PERMIT_GUIDANCE.titleZh}</strong>
                <p>{ACCESSIBLE_PERMIT_GUIDANCE.descriptionZh}</p>
              </span>
              <a
                href={ACCESSIBLE_PERMIT_GUIDANCE.officialUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="查看无障碍停车证官方说明"
              >
                <Icon icon="solar:arrow-right-up-linear" />
              </a>
            </div>
            </main>
          </div>
        </div>

        <footer className="permit-modal__footer">
          <p>
            <Icon icon="solar:shield-check-bold-duotone" />
            本地保存 · 证件年度 {PERMIT_YEAR_2026_27.label} · 核对日期{" "}
            {PERMIT_YEAR_2026_27.lastVerifiedOn}
          </p>
          <div>
            <a
              className="button button--ghost"
              href={OFFICIAL_PARKING_URLS.browsePermits}
              target="_blank"
              rel="noreferrer"
            >
              官方比较工具
            </a>
            <button
              type="button"
              className="button button--primary"
              onClick={() => onSave(draft, draftIdentity)}
            >
              保存到此浏览器
              <Icon icon="solar:check-circle-bold" />
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
