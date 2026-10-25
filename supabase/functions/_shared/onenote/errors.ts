export class ReconnectRequiredError extends Error {
  constructor(message = 'Microsoft account needs to be connected again') {
    super(message)
    this.name = 'ReconnectRequiredError'
  }
}
