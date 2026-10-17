export const STANDARD_PROJECT_TEMPLATE = { id: "medical-software-delivery", version: 1 } as const;

// Ordered WBS: every task depends on the immediately preceding task, including across phases.
export const STANDARD_PROJECT_TASKS = [
  { key: "kickoff", phase: "项目启动", title: "召开项目启动会", estimateHours: 4, dependsOn: null },
  { key: "master-plan", phase: "项目启动", title: "制定实施主计划", estimateHours: 8, dependsOn: "kickoff" },
  { key: "requirements", phase: "需求与蓝图", title: "业务需求调研", estimateHours: 40, dependsOn: "master-plan" },
  { key: "blueprint", phase: "需求与蓝图", title: "蓝图方案确认", estimateHours: 24, dependsOn: "requirements" },
  { key: "environment", phase: "系统配置", title: "基础数据与环境准备", estimateHours: 16, dependsOn: "blueprint" },
  { key: "configuration", phase: "系统配置", title: "系统参数与接口联调", estimateHours: 40, dependsOn: "environment" },
  { key: "sit", phase: "验证与测试", title: "系统集成测试 SIT", estimateHours: 24, dependsOn: "configuration" },
  { key: "uat", phase: "验证与测试", title: "用户验收测试 UAT", estimateHours: 40, dependsOn: "sit" },
  { key: "csv", phase: "验证与测试", title: "CSV 计算机化系统验证", estimateHours: 24, dependsOn: "uat" },
  { key: "migration", phase: "上线与培训", title: "历史数据迁移", estimateHours: 32, dependsOn: "csv" },
  { key: "training", phase: "上线与培训", title: "最终用户培训", estimateHours: 16, dependsOn: "migration" },
  { key: "go-live", phase: "上线与培训", title: "系统正式切换上线", estimateHours: 8, dependsOn: "training" },
  { key: "initial-acceptance", phase: "验收与运维", title: "项目初验", estimateHours: 8, dependsOn: "go-live" },
  { key: "handover", phase: "验收与运维", title: "项目终验与移交", estimateHours: 8, dependsOn: "initial-acceptance" },
] as const;
