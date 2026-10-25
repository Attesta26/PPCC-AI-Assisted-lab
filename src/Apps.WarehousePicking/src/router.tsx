import { createBrowserRouter } from "react-router-dom"
import Layout from "@/pages/Layout"
import WarehouseItemsPage from "@/pages/WarehouseItems"
import WarehouseItemDetailPage from "@/pages/WarehouseItemDetail"
import TransactionsPage from "@/pages/Transactions"
import LocationsPage from "@/pages/Locations"
import NotFoundPage from "@/pages/not-found"
import { registerEntities, setHostNavigate } from "@/providers/pcf-host"
import { warehouseEntities } from "@/utils/Entities"

// IMPORTANT: Do not remove or modify the code below!
// Normalize basename when hosted in Power Apps
const BASENAME = new URL(".", location.href).pathname
if (location.pathname.endsWith("/index.html")) {
  history.replaceState(null, "", BASENAME + location.search + location.hash);
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    errorElement: <NotFoundPage />,
    children: [
      { index: true, element: <WarehouseItemsPage /> },
      { path: "items", element: <WarehouseItemsPage /> },
      { path: "items/:id", element: <WarehouseItemDetailPage /> },
      { path: "transactions", element: <TransactionsPage /> },
      { path: "locations", element: <LocationsPage /> },
    ],
  },
], { 
  basename: BASENAME // IMPORTANT: Set basename for proper routing when hosted in Power Apps
})

// Lets TALXIS base controls open records (context.navigation.openForm) as in-app navigation
registerEntities(...warehouseEntities)
setHostNavigate((path) => router.navigate(path))
