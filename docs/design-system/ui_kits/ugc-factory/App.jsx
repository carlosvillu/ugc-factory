/* UGC Factory UI kit — root app: header + screen switcher + theme/accent state. */
function App() {
  const [screen, setScreen] = React.useState("pipeline");
  const [theme, setTheme] = React.useState("dark");
  const [accent, setAccent] = React.useState("indigo");

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-accent", accent);
  }, [theme, accent]);

  const Screen = { pipeline: window.PipelineScreen, library: window.LibraryScreen, spend: window.SpendScreen }[screen];

  return (
    <React.Fragment>
      <window.UgcHeader screen={screen} setScreen={setScreen} theme={theme} setTheme={setTheme} accent={accent} setAccent={setAccent} />
      <Screen />
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
