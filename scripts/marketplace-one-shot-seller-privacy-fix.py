from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected anchor once, found {count}')
    target.write_text(text.replace(old, new, 1))


replace_once(
    'web/src/pages/VehicleDetail.tsx',
    """                    <p className=\"font-medium\" data-testid=\"seller-name\">\n                      {vehicle.sellerName\n                        ?? (passport?.ownershipSummary?.currentSellerRecorded ? 'Not shown publicly' : 'Not recorded')}\n                    </p>\n""",
    """                    <p className=\"font-medium\" data-testid=\"seller-name\">\n                      {/* Marketplace seller-profile consent is authoritative as soon as detail loads.\n                          Do not wait for passport enrichment before honoring a disabled public profile:\n                          that race exposed \"Not recorded\" for a seller whose public identity is withheld. */}\n                      {detail?.seller_summary?.public_profile_enabled === false\n                        ? 'Not shown publicly'\n                        : vehicle.sellerName\n                          ?? (passport?.ownershipSummary?.currentSellerRecorded ? 'Not shown publicly' : 'Not recorded')}\n                    </p>\n""",
)

replace_once(
    'shared/types/marketplace.ts',
    '  display_label: string;\n',
    '  display_label: string | null;\n',
)

anchor = """  it('takes the gallery from the listing rows, never from the passport vehicle’s images key', async () => {\n"""
regression = """  it('honors Marketplace seller privacy before optional passport enrichment settles', async () => {\n    // Deployed staging exposed this exact first-render state: Marketplace detail was already public\n    // and declared the private seller profile disabled while passport enrichment was still pending.\n    // The UI must not turn that timing difference into an assertion that the seller name is absent.\n    lookupVehiclePassport.mockImplementation(() => new Promise(() => {}))\n    fetchMarketplaceListingDetail.mockResolvedValue({\n      ...detailFixture([image(CARD_IMAGE)]),\n      seller_summary: { display_label: null, seller_type: 'private', public_profile_enabled: false },\n    })\n\n    await renderSettled()\n    await waitFor(() => expect(screen.getByTestId('seller-name')).toBeTruthy())\n\n    expect(screen.getByTestId('seller-name').textContent).toBe('Not shown publicly')\n    expect(fetchMarketplaceListingDetail).toHaveBeenCalled()\n    expect(fetchVehicle).not.toHaveBeenCalled()\n  })\n\n"""
replace_once(
    'web/src/pages/VehicleDetail.media.test.tsx',
    anchor,
    regression + anchor,
)
