/*
 * Catches an error thrown while drawing the page and shows what happened (crash-view.js)
 * instead of a blank Admin frame. Plain elements on purpose: the crash may have come from
 * the component library itself.
 */
import { Component } from "react";

import { crashReport } from "#web/crash-view.js";

const reload = () => window.location.reload();

export class CrashBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(
      "The ERP integration page crashed",
      error,
      info.componentStack,
    );
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }
    const report = crashReport(this.state.error);
    return (
      <main className="erp-crash" role="alert">
        <h1>{report.title}</h1>
        <p>{report.body}</p>
        <button onClick={reload} type="button">
          Reload
        </button>
        <details>
          <summary>Details</summary>
          <pre>{report.details}</pre>
        </details>
      </main>
    );
  }
}
