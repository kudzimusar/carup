import { VehicleIdentity } from '@carup/design-system'

const HILUX = {
  title: 'Toyota Hilux 2.8 GD-6 Raider',
  vin: 'AHTGB3CD005123456',
  year: 2021,
  mileageKm: 62400,
  location: 'Harare',
}

export const PublicCard = () => <VehicleIdentity {...HILUX} variant="card" className="w-[360px]" />

export const WorkspaceCard = () => <VehicleIdentity {...HILUX} variant="card" exposure="workspace" className="w-[360px]" />

export const Rows = () => (
  <div className="w-[600px]">
    <VehicleIdentity {...HILUX} variant="row" />
    <VehicleIdentity title="Honda Fit 1.3 Hybrid" year={2014} mileageKm={118200} location="Bulawayo" variant="row" />
    <VehicleIdentity title="Nissan NP200 1.6 8V" year={2017} mileageKm={143900} location="Mutare" variant="row" />
  </div>
)

export const WorkspaceRows = () => (
  <div className="w-[600px]">
    <VehicleIdentity {...HILUX} variant="row" exposure="workspace" />
    <VehicleIdentity
      title="Mazda CX-5 2.0 Dynamic"
      vin="JMZKF2W7A00654321"
      year={2019}
      mileageKm={71250}
      location="Harare"
      variant="row"
      exposure="workspace"
    />
    <VehicleIdentity title="Ford Ranger 2.0 BiT XLT (partial record)" year={2022} variant="row" exposure="workspace" />
  </div>
)

export const Header = () => <VehicleIdentity {...HILUX} variant="header" exposure="workspace" />

export const MissingFields = () => <VehicleIdentity title="Mazda CX-5 2.0 Dynamic" variant="card" className="w-[360px]" />
