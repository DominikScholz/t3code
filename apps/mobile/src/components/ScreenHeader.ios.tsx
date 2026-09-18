import type { HeaderBarButtonMailSearchToolbarItem } from "react-native-screens";
import { NativeHeaderToolbar, NativeStackScreenOptions } from "../native/StackHeader";
import { useAdaptiveWorkspaceLayout } from "../features/layout/AdaptiveWorkspaceLayout";
import {
  createNativeMailSearchToolbarItem,
  NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED,
} from "../features/layout/native-mail-search-toolbar";
import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import type { ScreenHeaderMenuItem, ScreenHeaderProps } from "./ScreenHeader.types";
import type { AppSymbolName } from "./AppSymbol";

function iosIcon(icon: AppSymbolName) {
  return typeof icon === "string" ? icon : icon.ios;
}

function renderMenuItems(items: ReadonlyArray<ScreenHeaderMenuItem>) {
  return items.map((item) =>
    "items" in item ? (
      <NativeHeaderToolbar.Menu
        key={item.id}
        title={item.title}
        icon={item.icon}
        inline={item.inline}
      >
        {renderMenuItems(item.items)}
      </NativeHeaderToolbar.Menu>
    ) : (
      <NativeHeaderToolbar.MenuAction
        key={item.id}
        icon={item.icon}
        subtitle={item.subtitle}
        disabled={item.disabled}
        isOn={item.selected}
        onPress={item.onPress}
      >
        {item.title}
      </NativeHeaderToolbar.MenuAction>
    ),
  );
}

type MailMenu = NonNullable<HeaderBarButtonMailSearchToolbarItem["filterMenu"]>;
function mailMenuItems(items: ReadonlyArray<ScreenHeaderMenuItem>): MailMenu["items"] {
  return items.map((item) =>
    "items" in item
      ? { type: "submenu", title: item.title ?? "", items: mailMenuItems(item.items) }
      : {
          type: "action",
          title: item.title,
          state: item.selected ? "on" : "off",
          disabled: item.disabled,
          onPress: item.onPress,
        },
  );
}

export function ScreenHeader(props: ScreenHeaderProps) {
  const { layout, panes, togglePrimarySidebar } = useAdaptiveWorkspaceLayout();
  const { themeVariables } = useAppearancePreferences();
  const { search, menu } = props;
  const compactSearch =
    search !== undefined &&
    (search.compactToolbar ?? !layout.usesSplitView) &&
    NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED;
  const refresh = search?.refreshInToolbar ? search.onRefresh : undefined;
  return (
    <>
      <NativeStackScreenOptions
        optionsVersion={props.optionsVersion}
        options={{
          headerShown: true,
          title: props.title,
          unstable_headerSubtitle: props.subtitle || undefined,
          ...(props.matchSearchSurface
            ? { contentStyle: { backgroundColor: themeVariables["--color-sheet-solid"] } }
            : undefined),
          ...(search
            ? {
                unstable_headerToolbarItems: compactSearch
                  ? () => [
                      createNativeMailSearchToolbarItem({
                        placeholder: search.compactPlaceholder ?? search.placeholder,
                        onSearchTextChange: search.onChangeText,
                        searchTextChangeId: "header-search-text",
                        ...(refresh
                          ? {
                              composeButtonId: "header-refresh",
                              composeSystemImageName: "arrow.clockwise",
                              onComposePress: refresh,
                            }
                          : undefined),
                        ...(menu
                          ? {
                              filterButtonId: "header-filter",
                              filterSystemImageName: iosIcon(menu.icon),
                              filterMenu: { title: menu.title, items: mailMenuItems(menu.items) },
                            }
                          : undefined),
                      }),
                    ]
                  : undefined,
                headerSearchBarOptions: compactSearch
                  ? undefined
                  : {
                      allowToolbarIntegration: true,
                      ...(NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED && search.mode === "inline"
                        ? { placement: "integratedButton" as const }
                        : undefined),
                      autoCapitalize: "none",
                      hideNavigationBar: false,
                      ...(search.mode === "inline" ? { obscureBackground: false } : undefined),
                      placeholder: search.placeholder,
                      onChangeText: (event) => search.onChangeText(event.nativeEvent.text),
                      onCancelButtonPress: () => search.onChangeText(""),
                    },
              }
            : undefined),
          ...props.options,
        }}
      />
      {props.sidebar !== false && layout.usesSplitView ? (
        <NativeHeaderToolbar placement="left">
          {props.backInSplitView && props.onBack ? (
            <NativeHeaderToolbar.Button {...props.backInSplitView} onPress={props.onBack} />
          ) : null}
          <NativeHeaderToolbar.Button
            accessibilityLabel={
              panes.primarySidebarVisible ? `Maximize ${props.title.toLowerCase()}` : "Show threads"
            }
            icon={
              panes.primarySidebarVisible ? "arrow.up.left.and.arrow.down.right" : "sidebar.left"
            }
            onPress={togglePrimarySidebar}
            separateBackground
          />
        </NativeHeaderToolbar>
      ) : null}
      {(props.actions?.length || refresh || menu || props.trailing) && !compactSearch ? (
        <NativeHeaderToolbar placement="right">
          {props.actions?.map((action) => (
            <NativeHeaderToolbar.Button
              key={action.accessibilityLabel}
              {...action}
              icon={iosIcon(action.icon)}
              separateBackground
            />
          ))}
          {refresh ? (
            <NativeHeaderToolbar.Button
              accessibilityLabel={search?.refreshAccessibilityLabel}
              icon="arrow.clockwise"
              onPress={refresh}
              separateBackground
            />
          ) : null}
          {menu ? (
            <NativeHeaderToolbar.Menu
              title={menu.title}
              accessibilityLabel={menu.title}
              icon={iosIcon(menu.icon)}
              separateBackground={menu.separateBackground ?? true}
            >
              {menu.status ? (
                <NativeHeaderToolbar.Label>{menu.status}</NativeHeaderToolbar.Label>
              ) : null}
              {renderMenuItems(menu.items)}
            </NativeHeaderToolbar.Menu>
          ) : null}
          {props.trailing}
        </NativeHeaderToolbar>
      ) : null}
      {search && !compactSearch ? (
        <NativeHeaderToolbar placement="bottom">
          <NativeHeaderToolbar.SearchBarSlot />
        </NativeHeaderToolbar>
      ) : null}
    </>
  );
}
