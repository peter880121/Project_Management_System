import { actorHttp } from "@/modules/http/actor-http";
export const weeklyHttp = (
  request: Request,
  action: Parameters<typeof actorHttp>[1],
) => actorHttp(request, action, "周报");
