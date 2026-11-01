import { h, Component } from "preact";
import classNames from "classnames";
import { icon } from "./icons";
import { MathJax } from "./typeset";

export default class GridCell extends Component {
  componentDidMount() {
    this.componentDidUpdate();
  }

  shouldComponentUpdate(nextProps) {
    return (
      nextProps.value !== this.props.value ||
      nextProps.edit !== this.props.edit ||
      nextProps.selected !== this.props.selected ||
      nextProps.moving !== this.props.moving
    );
  }

  componentWillUpdate() {
    // Intentionally empty: typesetClear is a no-op and the raw text must
    // survive for typesetPromise to re-render it.
  }

  async componentDidUpdate(prevProps) {
    if (this.valueElement == null) return;

    let { onTypesetFinish = () => {} } = this.props;

    if (this.inputElement != null && prevProps.edit !== this.props.edit) {
      this.inputElement.select();
    }

    if (this.props.value) {
      await MathJax.typesetPromise([this.valueElement]);
    }

    onTypesetFinish({
      position: this.props.position,
      element: !this.props.value ? null : this.valueElement.querySelector(".cd-math"),
    });
  }

  submit = () => {
    let { onSubmit = () => {} } = this.props;
    onSubmit({ position: this.props.position });
  };

  handleGrabberPointerDown = (evt) => {
    let { onGrabberPointerDown = () => {} } = this.props;
    evt.position = this.props.position;
    onGrabberPointerDown(evt);
  };

  handleGrabberDragStart = (evt) => {
    evt.preventDefault();
  };

  handleEditSubmit = (evt) => {
    evt.preventDefault();
  };

  handleEditKeyDown = (evt) => {
    if (evt.key === "Enter") {
      evt.stopPropagation();
      this.submit();
    }
  };

  handleInputBlur = () => {
    this.submit();
  };

  stopPropagation = (evt) => {
    evt.stopPropagation();
  };

  handleInputChange = (evt) => {
    let { onChange = () => {} } = this.props;
    onChange({ position: this.props.position, value: evt.currentTarget.value });
  };

  handleAddLoop = (evt) => {
    let { onAddLoopClick = () => {} } = this.props;
    onAddLoopClick(evt);
  };

  render() {
    return (
      <li
        class={classNames("grid-cell", {
          edit: this.props.edit,
          selected: this.props.selected,
          moving: this.props.moving,
        })}
        data-position={this.props.position.join(",")}
      >
        <div class="value" ref={(el) => (this.valueElement = el)}>
          {this.props.value ? (
            <span class="cd-math" key={this.props.value}>{this.props.value}</span>
          ) : (
            <span class="hide">_</span>
          )}
        </div>

        {this.props.edit && (
          <form class="edit" onSubmit={this.handleEditSubmit}>
            <input
              ref={(el) => (this.inputElement = el)}
              type="text"
              value={this.props.value}
              onBlur={this.handleInputBlur}
              onInput={this.handleInputChange}
              onPointerDown={this.stopPropagation}
              onKeyDown={this.handleEditKeyDown}
            />
          </form>
        )}

        <img class="grabber" src={icon("grabber.svg")} onPointerDown={this.handleGrabberPointerDown} onDragStart={this.handleGrabberDragStart} />

        <img class="loop" src={icon("loop.svg")} title="Create Loop" alt="Create Loop" onClick={this.handleAddLoop} />
      </li>
    );
  }
}