"use client";

import { Icon } from "@iconify/react";
import { useEffect, useMemo, useState } from "react";

import { PermitPreviewPanel } from "@/components/map/permit-preview-panel";
import {
  ACCESSIBLE_PERMIT_GUIDANCE,
  getCurrentAccessSummary,
  isPermitCode,
  OFFICIAL_PARKING_URLS,
  PARKING_PERMITS,
  PERMIT_GROUPS,
  PERMIT_YEAR_2026_27,
  type PermitAudience,
} from "@/data/permits";
import { usePermitAreas } from "@/hooks/use-permit-areas";
import { resolvePermitZones } from "@/lib/permit-map";
import { cn, formatNumber } from "@/lib/utils";

const audienceIcon: Record<PermitAudience, string> = {
  "faculty-ap": "solar:square-academic-cap-2-bold-duotone",
  staff: "solar:case-round-bold-duotone",
  student: "solar:backpack-bold-duotone",
  other: "solar:users-group-rounded-bold-duotone",
};

export function getSelectedPermitLabel(code: string) {
  if (code === "visitor") return "访客 / 按小时停车";
  if (!isPermitCode(code)) return "尚未设置停车证";
  const permit = PARKING_PERMITS.find((item) => item.code === code);
  return permit ? `${permit.officialCode} · ${permit.nameZh}` : "尚未设置停车证";
}

export function PermitSettings({
  open,
  selectedCode,
  onSave,
  onClose,
}: {
  open: boolean;
  selectedCode: string;
  onSave: (code: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(selectedCode);
  const [referenceTime, setReferenceTime] = useState(() => Date.now());
  const [previewMapEnabled, setPreviewMapEnabled] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 821px)");
    const syncPreviewMode = () => setPreviewMapEnabled(media.matches);
    const frame = window.requestAnimationFrame(syncPreviewMode);
    media.addEventListener("change", syncPreviewMode);
    return () => {
      window.cancelAnimationFrame(frame);
      media.removeEventListener("change", syncPreviewMode);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      setDraft(selectedCode);
      setReferenceTime(Date.now());
    });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose, open, selectedCode]);

  const permit = useMemo(
    () => (isPermitCode(draft) ? PARKING_PERMITS.find((item) => item.code === draft) : undefined),
    [draft],
  );
  const summary = useMemo(
    () =>
      isPermitCode(draft)
        ? getCurrentAccessSummary(draft, referenceTime)
        : undefined,
    [draft, referenceTime],
  );
  const previewZones = useMemo(
    () => (summary ? resolvePermitZones(summary) : []),
    [summary],
  );
  const previewAreas = usePermitAreas(
    previewZones,
    open && previewMapEnabled && previewZones.length > 0,
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
            <button
              type="button"
              className={cn(
                "permit-choice permit-choice--special",
                draft === "none" && "is-active",
              )}
              onClick={() => setDraft("none")}
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
            <button
              type="button"
              className={cn(
                "permit-choice permit-choice--special",
                draft === "visitor" && "is-active",
              )}
              onClick={() => setDraft("visitor")}
            >
              <span>
                <Icon icon="solar:ticket-sale-bold-duotone" />
              </span>
              <span>
                <strong>访客 / 患者</strong>
                <small>按小时或访客停车</small>
              </span>
              <Icon icon="solar:alt-arrow-right-linear" />
            </button>

            {PERMIT_GROUPS.map((group) => (
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
                        onClick={() => setDraft(code)}
                      >
                        <b>{item.officialCode}</b>
                        <span>
                          <strong>{item.nameZh}</strong>
                          <small>
                            ${formatNumber(item.price.annualUsd)} / 年
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
              aria-label="当前停车证可用区域地图预览"
            >
              {summary && previewZones.length > 0 ? (
                <>
                  {previewMapEnabled && (
                    <PermitPreviewPanel
                      permitAreas={previewAreas.data}
                      showPermitAreas={!previewAreas.error}
                    />
                  )}
                  <div className="permit-preview__identity">
                    <span className="permit-preview__ticket">
                      <Icon icon="solar:ticket-bold-duotone" />
                      {summary.permit.officialCode}
                    </span>
                    <span>
                      <small>当前可用地面区域</small>
                      <strong>{previewZones.join(" / ")}</strong>
                    </span>
                  </div>
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
                    ) : previewHasFeatures ? (
                      <>
                        <Icon icon="solar:map-point-bold-duotone" />
                        地图按当前美东时段即时更新
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
              onClick={() => onSave(draft)}
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
