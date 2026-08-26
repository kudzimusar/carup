from pathlib import Path


detail_path = Path('web/src/pages/VehicleDetail.tsx')
detail = detail_path.read_text()
old_detail = '''        setVehicle((prev) => prev ?? vehicleFromMarketplaceDetail(d))
      })
'''
new_detail = '''        // A public Marketplace detail is sufficient to render the public listing. Passport lookup is
        // a richer enrichment path, not a prerequisite: staging proved that endpoint can remain pending
        // while the governed Marketplace detail has already returned successfully. Do not hold the
        // entire buyer page behind that independent read or a valid listing becomes an infinite spinner.
        // Preserve a richer vehicle already resolved for THIS VIN; replace any stale previous-route VIN.
        setVehicle((prev) => prev?.vin === d.vin ? prev : vehicleFromMarketplaceDetail(d))
        setLoanAmount((d.price ?? 0).toString())
        setLoading(false)
      })
'''
count = detail.count(old_detail)
if count != 1:
    raise SystemExit(f'VehicleDetail anchor expected once, found {count}')
detail_path.write_text(detail.replace(old_detail, new_detail, 1))


test_path = Path('web/src/pages/VehicleDetail.media.test.tsx')
test = test_path.read_text()
anchor = '''  it('takes the gallery from the listing rows, never from the passport vehicle’s images key', async () => {
'''
regression = '''  it('renders a public marketplace listing even when passport lookup never settles', async () => {
    // Deployed staging exposed this exact race: marketplace detail returned 200 while the richer
    // passport lookup stayed pending. A public listing must remain usable from its governed detail
    // response rather than leaving the buyer behind the page-wide loading spinner indefinitely.
    lookupVehiclePassport.mockImplementation(() => new Promise(() => {}))

    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

    expect(fetchMarketplaceListingDetail).toHaveBeenCalled()
    expect(fetchVehicle).not.toHaveBeenCalled()
    expect(screen.getByTestId('vehicle-image').getAttribute('src')).toBe(CARD_IMAGE)
  })

'''
count = test.count(anchor)
if count != 1:
    raise SystemExit(f'VehicleDetail media-test anchor expected once, found {count}')
test_path.write_text(test.replace(anchor, regression + anchor, 1))
