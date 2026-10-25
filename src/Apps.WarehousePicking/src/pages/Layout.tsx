import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Subtitle1, Tab, TabList, mergeClasses } from "@fluentui/react-components";
import { BoxRegular, ArrowSwapRegular, LocationRegular } from "@fluentui/react-icons";
import { useStyles } from "@/styles/Layout.styles";

const navigation = [
  { path: "/items", label: "Items", icon: <BoxRegular /> },
  { path: "/transactions", label: "Transactions", icon: <ArrowSwapRegular /> },
  { path: "/locations", label: "Locations", icon: <LocationRegular /> },
];

export default function Layout() {
  const styles = useStyles();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const selected = navigation.find(entry => pathname.startsWith(entry.path))?.path ?? "/items";

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Subtitle1>Warehouse Picking</Subtitle1>
          <TabList selectedValue={selected} onTabSelect={(_, data) => navigate(String(data.value))}>
            {navigation.map(entry => (
              <Tab key={entry.path} value={entry.path} icon={entry.icon}>{entry.label}</Tab>
            ))}
          </TabList>
        </div>
      </header>
      <main className={mergeClasses(styles.main, styles.mainWithBottomNav)}><Outlet /></main>
      <nav className={styles.bottomNav} aria-label="Main">
        {navigation.map(entry => (
          <button
            key={entry.path}
            type="button"
            className={mergeClasses(styles.bottomItem, selected === entry.path && styles.bottomItemSelected)}
            aria-current={selected === entry.path ? "page" : undefined}
            onClick={() => navigate(entry.path)}
          >
            <span className={styles.bottomIcon}>{entry.icon}</span>
            <span>{entry.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
