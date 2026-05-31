export function toCents(amount: number | string): number {
  return Math.round(parseFloat(String(amount)) * 100);
}

export function fromCents(cents: number): number {
  return parseFloat((cents / 100).toFixed(2));
}

// ZIMRA Import Duty calculation utility
export function calculateZimraDuty(vehiclePrice: number, yearManufactured: number, engineSizeCc = 1800) {
  const currentYear = new Date().getFullYear();
  const vehicleAge = currentYear - yearManufactured;
  
  const baseDutyPercent = 0.40; // 40% Customs Duty
  const vatPercent = 0.15;      // 15% VAT
  let surtaxPercent = 0.0;      // Surtax for vehicles older than 5 years
  
  if (vehicleAge > 5) {
    surtaxPercent = 0.35; // 35% surtax
  }
  
  const customsDuty = vehiclePrice * baseDutyPercent;
  const surtax = vehiclePrice * surtaxPercent;
  
  // VAT = (Price + Customs + Surtax) * 15%
  const vdp = vehiclePrice + customsDuty + surtax;
  const vat = vdp * vatPercent;
  
  const totalDuty = customsDuty + surtax + vat;
  
  return {
    vehiclePrice,
    vehicleAge,
    breakdown: {
      customsDuty: parseFloat(customsDuty.toFixed(2)),
      surtax: parseFloat(surtax.toFixed(2)),
      vat: parseFloat(vat.toFixed(2))
    },
    totalDuty: parseFloat(totalDuty.toFixed(2)),
    percentageOfValue: parseFloat(((totalDuty / vehiclePrice) * 100).toFixed(1))
  };
}

// SafePay split fees calculation utility
export function calculateEscrowSplit(amount: number) {
  const amountCents = toCents(amount);
  const feeEscrowCents = Math.round(amountCents * 0.012); // 1.2% escrow fee
  const feeZimraCents = Math.round(amountCents * 0.15);   // 15% flat ZIMRA stamp duty
  const sellerCents = amountCents - feeZimraCents - feeEscrowCents;

  return {
    amount: amount,
    amountCents,
    feeEscrow: fromCents(feeEscrowCents),
    feeZimra: fromCents(feeZimraCents),
    sellerReceives: fromCents(sellerCents)
  };
}

// Odometer verification checks
export function analyzeOdometerAnomaly(currentMileage: number, historyLogs: { mileage: number; timestamp: string }[]) {
  if (!historyLogs || historyLogs.length === 0) {
    return { anomalous: false, reason: 'No prior mileage history found.' };
  }

  // Sort logs by date ascending
  const sorted = [...historyLogs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  
  // Check if current mileage is less than the latest logged mileage
  const latestRecord = sorted[sorted.length - 1];
  if (currentMileage < latestRecord.mileage) {
    return {
      anomalous: true,
      reason: `Tampering detected: Entered mileage (${currentMileage} km) is less than prior logged mileage (${latestRecord.mileage} km recorded on ${new Date(latestRecord.timestamp).toLocaleDateString()}).`
    };
  }

  return { anomalous: false, reason: 'Mileage transition is sequential and valid.' };
}

// Localization and formatting helpers
export function formatCurrency(amount: number, currency: 'USD' | 'ZiG' | 'ZAR' | 'BWP' = 'USD'): string {
  const symbolMap = {
    USD: '$',
    ZiG: 'ZiG ',
    ZAR: 'R ',
    BWP: 'P '
  };
  return `${symbolMap[currency] || '$'}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
