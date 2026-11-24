import ErrorCard from "@core/ui/reporter/components/ErrorCard";
import { React } from "@metro/common";
import { ThemeContext } from "@ui/styles";
import { Falsy } from "react-native";

type ErrorBoundaryState = {
    hasErr: false;
} | {
    hasErr: true;
    error: Error;
};

export interface ErrorBoundaryProps {
    children: JSX.Element | Falsy | (JSX.Element | Falsy)[];
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasErr: false };
    }

    static contextType = ThemeContext;
    static getDerivedStateFromError = (error: Error) => ({ hasErr: true, error });

    componentDidCatch(error: Error) {
        // Listed in Doctor, with where it came from.
        try {
            const { recordProblem, sourceOf } = require("@lib/api/problems");
            recordProblem("a Deltacord page or card", error, sourceOf(error));
        } catch { }
    }

    render() {
        if (!this.state.hasErr) return this.props.children;

        return (
            <ErrorCard
                error={this.state.error}
                onRetryRender={() => this.setState({ hasErr: false })}
            />
        );
    }
}
