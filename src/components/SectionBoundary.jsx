import React from 'react'

export default class SectionBoundary extends React.Component {
  constructor(props){
    super(props)
    this.state={error:null,attempt:0}
  }

  static getDerivedStateFromError(error){
    return {error}
  }

  componentDidCatch(error,info){
    console.error('RCXT section render error',this.props?.name||'section',error,info)
  }

  retry=()=>{
    this.setState((state)=>({error:null,attempt:state.attempt+1}))
  }

  render(){
    if(this.state.error){
      return (
        <div className="sectionCrash">
          <span>SECTION RECOVERED</span>
          <strong>{this.props?.name||'This tool'} hit incomplete data.</strong>
          <p>RCXT kept the rest of the app running. Retry this section or run the scan again.</p>
          <button className="toolButton" onClick={this.retry}>Retry section</button>
        </div>
      )
    }
    return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>
  }
}
