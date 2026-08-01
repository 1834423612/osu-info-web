import { Icon } from "@iconify/react";

export function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="empty-state">
      <span>
        <Icon icon="solar:magnifer-linear" />
      </span>
      <h3>没有找到匹配的停车点</h3>
      <p>换个名称，或清除当前筛选条件。</p>
      <button type="button" onClick={onReset}>
        清除筛选
      </button>
    </div>
  );
}
