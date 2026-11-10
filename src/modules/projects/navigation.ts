export function projectNavigationLinks(projectId: string, role: string) {
  const base = `/projects/${projectId}`;
  return [
    { key: "board", href: `${base}/board`, label: "任务看板", primary: true },
    { key: "requirements", href: `${base}/requirements`, label: "需求管理", primary: true },
    { key: "settings", href: `${base}/settings`, label: "项目设置", primary: false },
    { key: "acceptance", href: `${base}/acceptance`, label: "验收与归档", primary: false },
    { key: "deliverables", href: `${base}/deliverables`, label: "交付物资产", primary: true },
    { key: "meetings", href: `${base}/meetings`, label: "会议纪要", primary: true },
    { key: "planning", href: `${base}/planning`, label: "甘特图", primary: true },
    { key: "traceability", href: `${base}/traceability`, label: "需求与测试追溯", primary: false },
    { key: "documents", href: `${base}/documents`, label: "项目文档", primary: false },
    { key: "members", href: `${base}/members`, label: "项目成员", primary: false },
    ...(role === "PM" ? [{ key: "wbs", href: `${base}/wbs`, label: "智能 WBS 分解", primary: false }, { key: "risks", href: `${base}/risks`, label: "风险预警", primary: false }] : []),
    ...(["ADMIN", "QA"].includes(role) ? [{ key: "exports", href: `${base}/exports`, label: "合规导出", primary: false }] : []),
  ];
}
