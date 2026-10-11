import { RiskLimits } from "@mayflower/shared";
import { getContainer } from "@/lib/container";
import { withUser } from "@/lib/api";
export const dynamic = "force-dynamic";

export async function GET() {
  return withUser(async (user) => ({ user, theses: await getContainer().repo.listTheses(user.id) }));
}
/** Direct edit of risk limits from the settings page (the risk engine enforces these). */
export async function PUT(req: Request) {
  const body = await req.json();
  return withUser(async (user) => {
    const limits = RiskLimits.parse({ ...user.riskLimits, ...body });
    await getContainer().repo.updateRiskLimits(user.id, limits);
    await getContainer().repo.audit({ userId: user.id, actor: "user", action: "risk_limits.updated", payload: limits });
    return { limits };
  });
}
