import { h, Component } from "preact";
import classNames from "classnames";
import { icon } from "./icons";

export class Button extends Component {
  handleClick = (evt) => {
    evt.preventDefault();
    let { onClick = () => {} } = this.props;
    onClick(evt);
  };

  render() {
    let { checked, disabled, icon: ic, name, active, badge } = this.props;
    return (
      <li class={classNames("button", this.props.class, { checked, disabled, active })} title={name}>
        {badge != null && <span class="badge">{badge}</span>}
        <a href="#" onClick={this.handleClick}>
          <img style={{ backgroundImage: `url('${ic}')` }} src={icon("tools/blank.svg")} alt={name} />
        </a>
      </li>
    );
  }
}

export const Separator = () => <li class="separator">Separator</li>;

export default class Toolbox extends Component {
  render() {
    return (
      <section class={classNames("toolbox", this.props.class)} id={this.props.id}>
        <ul>{this.props.children}</ul>
      </section>
    );
  }
}