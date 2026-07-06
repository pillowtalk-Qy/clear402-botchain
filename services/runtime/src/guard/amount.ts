const decimalPattern = /^\d+(?:\.\d+)?$/;

export function parseDecimalToMinorUnits(amount: string, decimals = 18): bigint {
  if (!decimalPattern.test(amount)) {
    throw new Error(`Invalid decimal amount: ${amount}`);
  }

  const [whole = "0", fraction = ""] = amount.split(".");
  const normalizedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(`${whole}${normalizedFraction}`.replace(/^0+(?=\d)/, "") || "0");
}

export function compareDecimalStrings(left: string, right: string, decimals = 18): number {
  const leftMinor = parseDecimalToMinorUnits(left, decimals);
  const rightMinor = parseDecimalToMinorUnits(right, decimals);

  if (leftMinor < rightMinor) {
    return -1;
  }

  if (leftMinor > rightMinor) {
    return 1;
  }

  return 0;
}

export function addDecimalStrings(left: string, right: string, decimals = 18): string {
  return formatMinorUnits(
    parseDecimalToMinorUnits(left, decimals) + parseDecimalToMinorUnits(right, decimals),
    decimals
  );
}

export function subtractDecimalStrings(left: string, right: string, decimals = 18): string {
  const result =
    parseDecimalToMinorUnits(left, decimals) - parseDecimalToMinorUnits(right, decimals);

  if (result < 0n) {
    throw new Error("Decimal subtraction would become negative");
  }

  return formatMinorUnits(result, decimals);
}

export function formatMinorUnits(value: bigint, decimals = 18): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const raw = absolute.toString().padStart(decimals + 1, "0");
  const whole = raw.slice(0, -decimals) || "0";
  const fraction = raw.slice(-decimals).replace(/0+$/, "");

  return fraction.length > 0 ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}
