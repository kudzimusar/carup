export function calculateZimraDuty(vehiclePrice, yearManufactured, engineSizeCc = 1800) {
  const currentYear = new Date().getFullYear();
  const vehicleAge = currentYear - yearManufactured;
  
  // Standard Zimbabwean customs duty rules
  const baseDutyPercent = 0.40; // 40% Customs Duty
  const vatPercent = 0.15;      // 15% VAT
  let surtaxPercent = 0.0;     // 35% surtax for vehicles older than 5 years
  
  if (vehicleAge > 5) {
    surtaxPercent = 0.35;
  }
  
  const customsDuty = vehiclePrice * baseDutyPercent;
  const surtax = vehiclePrice * surtaxPercent;
  
  // VAT is calculated on Value for Duty Purposes (VDP) = Price + Customs + Surtax
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

export async function simulateZimraClearance(vin, customsReceiptNumber) {
  const timestamp = new Date().toISOString();
  
  // Simulate mock ZIMRA API clearing response
  return {
    vin,
    customsReceiptNumber,
    clearedStatus: 'CLEARED_DUTY_PAID',
    zimraAuthorizedBy: 'ZIMRA_OFFICER_CHIKOMBA_920',
    clearanceDate: timestamp,
    ledgerHashPayload: {
      action: 'ZIMRA_DUTY_RECONCILIATION',
      cleared: true,
      audited: true
    }
  };
}
