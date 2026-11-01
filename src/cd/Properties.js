import {h, Fragment, Component} from 'preact'
import classNames from 'classnames'
import {clamp, CMD_TIMEOUT} from './helper'
import {icon} from './icons'

import Toolbox, {Button, Separator} from './Toolbox'

export default class Properties extends Component {
  constructor() {
    super()

    this.state = {
      edit: false,
      editTop: 0,
      editLeft: 0
    }
  }

  componentDidMount() {
    this._keyHandler = (evt) => {
      if (evt.ctrlKey || evt.metaKey || !this.props.show || this.state.edit)
        return
      if (evt.target != null) {
        const t = evt.target
        if (t.tagName === "TEXTAREA" || (t.closest && t.closest(".cm-editor")) != null)
          return
      }
      const data = this.props.data || {}

      // Multi-key sequences (op reverse, dt dotted, ds dashed, sd solid,
      // db double, dd delete) are checked FIRST: dt/ds/db/dd share their
      // first letter with the single-key commands below (t/h/e...), so a
      // pending prefix must win over the second key, otherwise `dt` would
      // fire the tail-cycle (`t`) instead of dotted.
      const mapped = {
        op: () => this.handleButtonClick("reversearrow")(),
        dt: () => this.handleButtonClick("dotted")(),
        ds: () => this.handleButtonClick("dashed")(),
        sd: () => this.handleButtonClick("solid")(),
        db: () => this.handleButtonClick("double")(),
        dd: () => { let { onRemoveClick = () => {} } = this.props; onRemoveClick(evt) },
      }
      const seqs = Object.keys(mapped)
      const now = Date.now()
      if (this._seqTime == null || now - this._seqTime > CMD_TIMEOUT) this._seq = ""
      const seq = (this._seq || "") + evt.key.toLowerCase()
      const isExact = mapped[seq] != null
      const isPrefix = seqs.some((s) => s.length > seq.length && s.startsWith(seq))
      const report = (s) => {
        let { onBufferChange = () => {} } = this.props
        onBufferChange(s || "")
      }
      if (isExact || isPrefix) {
        evt.preventDefault()
        if (isExact && !isPrefix) {
          this._seq = ""
          this._seqTime = 0
          report("")
          mapped[seq]()
          return
        }
        this._seq = seq
        this._seqTime = now
        report(seq)
        return
      }
      this._seq = ""
      this._seqTime = 0
      report("")

      // Alt/Escape: cancel any pending sequence (the app handles the key)
      if (evt.key === "Alt" || evt.key === "Escape") return

      // Edit the arrow label
      if (evt.key === "Enter") {
        evt.preventDefault()
        this.handleEditButtonClick()
        return
      }

      // Delete / Backspace removes the arrow
      if (evt.key === "Delete" || evt.key === "Backspace") {
        evt.preventDefault()
        let { onRemoveClick = () => {} } = this.props
        onRemoveClick(evt)
        return
      }

      // ArrowUp/ArrowDown: shift the label sideways; Shift+Arrow: bend.
      // The direction of Shift-left/right conventions mirror the reference
      // app: Down = shift right, Up = shift left, Shift+Down = bend right,
      // Shift+Up = bend left.
      if (evt.key === "ArrowUp" || evt.key === "ArrowDown") {
        if (data.loop != null) return
        evt.preventDefault()
        let action = evt.shiftKey
          ? evt.key === "ArrowUp" ? "bendleft" : "bendright"
          : evt.key === "ArrowUp" ? "shiftleft" : "shiftright"
        this.handleButtonClick(action)()
        return
      }

      // t: cycle tail  (tail -> maps to -> hook)
      if (evt.key === "t" || evt.key === "T") {
        if (data.line === "none" || data.line === "double") return
        evt.preventDefault()
        this.cycleTail()
        return
      }

      // h: cycle head (default -> harpoon -> two heads)
      if (evt.key === "h" || evt.key === "H") {
        if (data.line === "none" || data.line === "double") return
        evt.preventDefault()
        this.cycleHead()
        return
      }

      // l: cycle label position (left -> right -> inside)
      if (evt.key === "l" || evt.key === "L") {
        evt.preventDefault()
        this.cycleLabelPos()
        return
      }

      // e: move the arrow's end to another cell (loops just rotate)
      if (evt.key === "e" || evt.key === "E") {
        evt.preventDefault()
        if (data.loop != null) {
          this.handleButtonClick("rotate")()
        } else {
          let { onRebindEnd = () => {} } = this.props
          onRebindEnd(evt)
        }
        return
      }
    }
    document.addEventListener("keydown", this._keyHandler)
  }

  componentWillUnmount() {
    if (this._keyHandler != null) {
      document.removeEventListener("keydown", this._keyHandler)
      this._keyHandler = null
    }
  }

  shouldComponentUpdate(nextProps, nextState) {
    return (
      nextProps.show !== this.props.show ||
      nextProps.data !== this.props.data ||
      nextState.edit !== this.state.edit ||
      nextState.editTop !== this.state.editTop ||
      nextState.editLeft !== this.state.editLeft
    )
  }

  componentDidUpdate(_, prevState) {
    if (!prevState.edit && this.state.edit) {
      this.inputElement.select()
    } else if (prevState.edit && !this.state.edit) {
      this.inputElement.blur()
    }
  }

  updateEditPosition() {
    let valueElement = document.querySelector(
      `.grid-arrow[data-id="${this.props.edgeId}"] .value`
    )
    if (valueElement == null) return
    let {left, top, width} = valueElement.getBoundingClientRect()
    let {width: editWidth, height: editHeight} = window.getComputedStyle(
      this.editElement
    )

    this.setState({
      editLeft: left + width / 2 - parseFloat(editWidth) / 2,
      editTop: top - parseFloat(editHeight) - 10
    })
  }

  handleButtonClick = id => {
    if (this.buttonClickHandlersCache == null)
      this.buttonClickHandlersCache = {}

    if (this.buttonClickHandlersCache[id] == null) {
      this.buttonClickHandlersCache[id] = evt => {
        let {data, onChange = () => {}} = this.props
        let change = {}

        if (['tail', 'mapsto', 'twoheads'].includes(id)) {
          let prop = id === 'twoheads' ? 'head' : 'tail'

          change = {[prop]: data[prop] === id ? 'none' : id}
        } else if (id === 'head') {
          change = {head: data.head == null ? 'none' : null}
        } else if (['double', 'solid', 'dashed', 'dotted'].includes(id)) {
          change = {line: (data.line || 'solid') === id ? 'none' : id}

          if (change.line === 'double') {
            change = {
              ...change,
              ...([null, 'none'].includes(data.head) ? {} : {head: null}),
              ...([null, 'mapsto', 'none'].includes(data.tail)
                ? {}
                : {tail: 'none'})
            }
          } else if (change.line === 'none') {
            change = {
              ...change,
              head: 'none',
              tail: 'none',
              labelPosition: 'inside'
            }
          }
        } else if (['labelleft', 'labelright', 'labelinside'].includes(id)) {
          change = {
            labelPosition: data.line === 'none' ? 'inside' : id.slice(5)
          }
        } else if (['hook', 'harpoon'].includes(id)) {
          let prop = id === 'hook' ? 'tail' : 'head'
          let ids = [id, `${id}alt`, 'none']
          let index = (ids.indexOf(data[prop]) + 1) % ids.length

          change = {[prop]: ids[index]}
        } else if (['bendleft', 'bendright'].includes(id)) {
          if (data.loop != null) return

          let {bend = 0} = data
          let increase = bend === 0 || (id === 'bendleft' ? bend > 0 : bend < 0)
          let sign = bend !== 0 ? Math.sign(bend) : id === 'bendleft' ? 1 : -1
          let steps = [0, 30, 49, 60, 67, 71, 74, 76, 78, 79, 80]

          let index = steps.reduce(
            (acc, x, i) => (x <= Math.abs(bend) ? i : acc),
            -1
          )
          if (
            index < steps.length - 1 &&
            bend >= (steps[index + 1] + steps[index]) / 2
          )
            index++

          let newBend =
            sign *
            // the step index must stay inside the table: with a small
            // NEGATIVE bend and "bend left" the index went to -1, and
            // steps[-1] is undefined -> bend = NaN -> the arrow vanished
            // from the canvas and lost its bend in the LaTeX
            steps[
              Math.max(
                0,
                Math.min(steps.length - 1, index + (+increase * 2 - 1))
              )
            ]

          change = {bend: Number.isFinite(newBend) ? clamp(-80, 80, newBend) : 0}
        } else if (['resetbend'].includes(id)) {
          change = {bend: 0, shift: 0}
        } else if (['shiftleft', 'shiftright'].includes(id)) {
          if (data.loop != null) return

          let {shift = 0} = data
          change = {shift: shift + (id === 'shiftright' ? 1 : -1)}
        } else if (['reversearrow'].includes(id)) {
          let {from, to, labelPosition} = data

          change = {to: from, from: to}

          // Invert label position

          if (labelPosition != null) {
            let newLabelPos = labelPosition

            if (labelPosition === 'left') {
              newLabelPos = 'right'
            } else if (labelPosition === 'right') {
              newLabelPos = 'left'
            }

            change.labelPosition = newLabelPos
          }

          // Invert bend

          if (data.bend != null) {
            change.bend = -data.bend
          }

          // Invert shift

          if (data.shift != null) {
            change.shift = -data.shift
          }

          // Invert loop direction

          if (data.loop != null) {
            let [angle, clockwise] = data.loop
            change.loop = [angle, !clockwise]
          }
        } else if (['rotate'].includes(id)) {
          if (data.loop == null) return

          let [angle, clockwise] = data.loop
          change.loop = [(angle + 90) % 360, clockwise]
        }

        onChange({data: {...data, ...change}})
      }
    }

    return this.buttonClickHandlersCache[id]
  }

  // t: cycle tail (tail -> maps to -> hook -> back to first)
  cycleTail() {
    let { data, onChange = () => {} } = this.props
    let seq = ["tail", "mapsto", "hook"]
    let cur = data.tail === "hookalt" ? "hook" : data.tail
    let index = seq.indexOf(cur)
    if (index === -1) index = -1
    let next = seq[(index + 1) % seq.length]
    onChange({ data: { ...data, tail: next } })
  }

  // h: cycle head (default -> harpoon -> two heads)
  cycleHead() {
    let { data, onChange = () => {} } = this.props
    let seq = [null, "harpoon", "twoheads"]
    let cur = data.head === "harpoonalt" ? "harpoon" : data.head
    let index = seq.indexOf(cur)
    if (index === -1) index = 0
    let next = seq[(index + 1) % seq.length]
    onChange({ data: { ...data, head: next } })
  }

  // l: cycle label position (left -> right -> inside)
  cycleLabelPos() {
    let { data, onChange = () => {} } = this.props
    if (data.line === "none") {
      onChange({ data: { ...data, labelPosition: "inside" } })
      return
    }
    let seq = ["left", "right", "inside"]
    let cur = data.labelPosition || "left"
    let index = seq.indexOf(cur)
    if (index === -1) index = 0
    let next = seq[(index + 1) % seq.length]
    onChange({ data: { ...data, labelPosition: next } })
  }

  handleEditButtonClick = () => {
    this.updateEditPosition()
    this.setState({edit: true})
  }

  handleFormSubmit = evt => {
    evt.preventDefault()
    this.setState({edit: false})
  }

  handleInputBlur = () => {
    this.setState({edit: false})
  }

  handleInputChange = evt => {
    let {value} = evt.currentTarget
    let {onChange = () => {}} = this.props

    onChange({data: {...this.props.data, value}})
  }

  handleInputKeyDown = evt => {
    evt.stopPropagation()
  }

  handleInputKeyUp = evt => {
    if (evt.key === 'Escape') {
      evt.stopPropagation()
      this.setState({edit: false})
    }
  }

  render() {
    let data = this.props.data == null ? {} : this.props.data

    return (
      <section
        id="properties"
        class={classNames({
          show: this.props.show,
          edit: this.state.edit
        })}
      >
        <Toolbox>
          <Button
            checked={false}
            icon={icon("properties/reverse.svg")}
            name="Reverse Arrow (op)"
            badge="op"
            onClick={this.handleButtonClick('reversearrow')}
          />

          <Separator />

          <Button
            checked={data.tail === 'tail'}
            disabled={['none', 'double'].includes(data.line)}
            icon={icon("properties/tail.svg")}
            name="Tail (t cycles)"
            badge="t"
            onClick={this.handleButtonClick('tail')}
          />

          <Button
            checked={data.tail === 'mapsto'}
            disabled={['none'].includes(data.line)}
            icon={icon("properties/mapsto.svg")}
            name="Maps To (t cycles)"
            badge=""
            onClick={this.handleButtonClick('mapsto')}
          />

          <Button
            checked={['hook', 'hookalt'].includes(data.tail)}
            disabled={['none', 'double'].includes(data.line)}
            icon={icon("properties/" + (data.tail === 'hookalt' ? 'hookalt' : 'hook') + ".svg")}
            name="Hook (t cycles)"
            badge=""
            onClick={this.handleButtonClick('hook')}
          />

          <Separator />

          <Button
            checked={data.line === 'dotted'}
            icon={icon("properties/dotted.svg")}
            name="Dotted (dt)"
            badge="dt"
            onClick={this.handleButtonClick('dotted')}
          />

          <Button
            checked={data.line === 'dashed'}
            icon={icon("properties/dashed.svg")}
            name="Dashed (ds)"
            badge="ds"
            onClick={this.handleButtonClick('dashed')}
          />

          <Button
            checked={!data.line || data.line === 'solid'}
            icon={icon("properties/solid.svg")}
            name="Solid (sd)"
            badge="sd"
            onClick={this.handleButtonClick('solid')}
          />

          <Button
            checked={data.line === 'double'}
            icon={icon("properties/double.svg")}
            name="Double (db)"
            badge="db"
            onClick={this.handleButtonClick('double')}
          />

          <Separator />

          {data.loop == null ? (
            <>
              <Button
                key="shiftright"
                icon={icon("properties/shiftright.svg")}
                name="Shift Right (ArrowDown)"
                badge="↓"
                onClick={this.handleButtonClick('shiftright')}
              />

              <Button
                key="shiftleft"
                icon={icon("properties/shiftleft.svg")}
                name="Shift Left (ArrowUp)"
                badge="↑"
                onClick={this.handleButtonClick('shiftleft')}
              />

              <Button
                key="bendright"
                icon={icon("properties/bendright.svg")}
                name="Bend Right (Shift+ArrowDown)"
                badge="Sh↓"
                onClick={this.handleButtonClick('bendright')}
              />

              <Button
                key="bendleft"
                icon={icon("properties/bendleft.svg")}
                name="Bend Left (Shift+ArrowUp)"
                badge="Sh↑"
                onClick={this.handleButtonClick('bendleft')}
              />
            </>
          ) : (
            <>
              <Button
                key="rotate"
                icon={icon("properties/rotate.svg")}
                name="Rotate (E)"
                badge="e"
                onClick={this.handleButtonClick('rotate')}
              />
            </>
          )}

          <Separator />

          <Button
            checked={['harpoon', 'harpoonalt'].includes(data.head)}
            disabled={['none', 'double'].includes(data.line)}
            icon={icon("properties/" + (data.head === 'harpoonalt' ? 'harpoonalt' : 'harpoon') + ".svg")}
            name="Harpoon (h cycles)"
            badge=""
            onClick={this.handleButtonClick('harpoon')}
          />

          <Button
            checked={data.head == null}
            disabled={['none'].includes(data.line)}
            icon={icon("properties/head.svg")}
            name="Default Head (h cycles)"
            badge=""
            onClick={this.handleButtonClick('head')}
          />

          <Button
            checked={data.head == 'twoheads'}
            disabled={['none', 'double'].includes(data.line)}
            icon={icon("properties/twoheads.svg")}
            name="Two Heads (h cycles)"
            badge=""
            onClick={this.handleButtonClick('twoheads')}
          />

          <Separator />

          <Button
            checked={!data.labelPosition || data.labelPosition === 'left'}
            disabled={['none'].includes(data.line)}
            icon={icon("properties/labelleft.svg")}
            name="Left Label (l cycles)"
            badge="l"
            onClick={this.handleButtonClick('labelleft')}
          />

          <Button
            checked={data.labelPosition === 'inside'}
            icon={icon("properties/labelinside.svg")}
            name="Inside Label (l cycles)"
            badge=""
            onClick={this.handleButtonClick('labelinside')}
          />

          <Button
            checked={data.labelPosition === 'right'}
            disabled={['none'].includes(data.line)}
            icon={icon("properties/labelright.svg")}
            name="Right Label (l cycles)"
            badge=""
            onClick={this.handleButtonClick('labelright')}
          />

          <Button
            checked={this.state.edit}
            icon={icon("properties/edit.svg")}
            name="Edit Label (Enter)"
            badge="⏎"
            onClick={this.handleEditButtonClick}
          />

          <Separator />

          <Button
            class="remove"
            icon={icon("properties/trash.svg")}
            name="Remove Arrow (dd)"
            badge="dd"
            onClick={this.props.onRemoveClick}
          />
        </Toolbox>

        <form
          ref={el => (this.editElement = el)}
          class="edit"
          style={{
            left: this.state.editLeft,
            top: this.state.editTop
          }}
          onSubmit={this.handleFormSubmit}
        >
          <input
            ref={el => (this.inputElement = el)}
            type="text"
            value={data.value || ''}
            onBlur={this.handleInputBlur}
            onInput={this.handleInputChange}
            onKeyDown={this.handleInputKeyDown}
            onKeyUp={this.handleInputKeyUp}
          />
        </form>
      </section>
    )
  }
}
