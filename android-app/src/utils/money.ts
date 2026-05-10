export function repairAmount(finalCost: number, estimatedCost: number) {
  return finalCost > 0 ? finalCost : estimatedCost;
}

export function balanceAmount(finalCost: number, estimatedCost: number, advancePaid: number) {
  return Math.max(repairAmount(finalCost, estimatedCost) - advancePaid, 0);
}

export function paymentStatus(finalCost: number, estimatedCost: number, advancePaid: number) {
  const amount = repairAmount(finalCost, estimatedCost);
  if (advancePaid <= 0) {
    return "Unpaid";
  }
  if (advancePaid >= amount) {
    return "Paid";
  }
  return "Partial";
}

export function money(value: number) {
  return `Rs. ${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}
