import stringSimilarity from 'string-similarity'
import { SPACE_ID } from './../contants'
import { dynamicStyles } from './../config'
import { maybeAddNegative } from './../negative'
import {
  throwIf,
  withAlpha,
  transparentTo,
  isEmpty,
  splitOnFirst,
  getTheme,
} from './../utils'
import { logBadGood } from './../logging'

const searchDynamicConfigByProperty = propertyName => {
  const result = Object.entries(dynamicStyles).find(([k]) => propertyName === k)
  if (!result) return

  return result[1]
}

const showSuggestions = (property, value) => {
  const suggestions = getSuggestions(property, value)
  throwIf(true, () =>
    logBadGood(
      `The arbitrary class “${property}” in “${property}-[${value}]” wasn’t found`,
      suggestions.length > 0 && `Try one of these:\n\n${suggestions.join(', ')}`
    )
  )
}

const getSuggestions = (property, value) => {
  const results = stringSimilarity.findBestMatch(
    property,
    Object.keys(dynamicStyles).filter(s => s.hasArbitrary !== 'false')
  )
  const suggestions = results.ratings.filter(item => item.rating > 0.25)

  return suggestions.length > 0
    ? suggestions.map(s => `${s.target}-[${value}]`)
    : []
}

const lengthUnits = [
  'cm',
  'mm',
  'Q',
  'in',
  'pc',
  'pt',
  'px',
  'em',
  'ex',
  'ch',
  'rem',
  'lh',
  'vw',
  'vh',
  'vmin',
  'vmax',
  '%',
]

const isLength = value => {
  const unitsPattern = `(?:${lengthUnits.join('|')})`
  return (
    new RegExp(`${unitsPattern}$`).test(value) ||
    new RegExp(`^calc\\(.+?${unitsPattern}`).test(value)
  )
}

const typeMap = {
  all: ({ config, value, theme }) => config(value, theme),
  color: ({ config, value, pieces, theme, hasFallback }) => {
    if (typeof config === 'function') return config(value, theme)
    const { property, variable } = config
    if (!property) return
    return withAlpha({
      color: value,
      property,
      pieces,
      hasFallback,
      ...(variable && { variable }),
    })
  },
  length: ({ config, value, theme }) => {
    if (!isLength(value) && !value.startsWith('var(')) return
    if (typeof config === 'function') return config(value, theme)
    const { property } = config
    if (property) return { [property]: value }
  },
  url: ({ value }) => {
    if (value.startsWith('url('))
      return {
        backgroundImage: value,
      }
  },
  lookup: ({ config, value, theme }) => config(value, theme),
}

const getCoercedValue = (customValue, context) => {
  const [explicitType, value] = splitOnFirst(customValue, ':')
  if (value.length === 0) return

  const coercedConfig = context.config.coerced
  if (!coercedConfig) return

  const coercedOptions = Object.keys(coercedConfig)
  throwIf(!coercedOptions.includes(explicitType), () =>
    logBadGood(
      `The coerced value of “${explicitType}” isn’t available`,
      `Try one of these coerced classes:\n\n${coercedOptions
        .map(o => `${context.property}-[${o}:${value}]`)
        .join(', ')}`
    )
  )

  const result = typeMap[explicitType]({
    config: coercedConfig[explicitType],
    value,
    pieces: context.pieces,
    theme: getTheme(context.state.config.theme),
  })
  return result
}

const getClassData = className => {
  const [property, value] = splitOnFirst(
    className
      // Replace the "stand-in spaces" with real ones
      .replace(new RegExp(SPACE_ID, 'g'), ' '),
    '['
  )
  return {
    property: property.slice(0, -1), // Remove the dash just before the brackets
    value: value.slice(0, -1).trim(), // Remove the last ']' and whitespace
  }
}

export default ({ state, pieces }) => {
  let { property, value } = getClassData(pieces.classNameNoSlashAlpha)

  let config = searchDynamicConfigByProperty(property) || {}

  // Check for coerced value
  // Values that have their type specified: [length:3px]/[color:red]/etc
  const coercedValue = getCoercedValue(value, {
    property,
    pieces,
    state,
    config,
  })
  if (coercedValue) return coercedValue

  // Theme values, eg: tw`text-[theme(colors.red.500)]`
  const themeValue = value.match(/theme\('?([^']+)'?\)/)
  if (themeValue) {
    const val = getTheme(state.config.theme)(themeValue[1])
    if (val) value = val
  }

  // Deal with font array
  if (Array.isArray(config)) {
    const value = config.find(c => c.value)
    value && (config = value)
  }

  ;(isEmpty(config) || Array.isArray(config)) &&
    showSuggestions(property, value)

  throwIf(config.hasArbitrary === false, () =>
    logBadGood(
      `There is no support for the arbitrary value “${property}” in “${property}-[${value}]”`
    )
  )

  if (Array.isArray(config.value)) {
    let arbitraryValue
    config.value.find(type => {
      const result = typeMap[type]({
        config: config.coerced[type],
        value,
        pieces,
        theme: getTheme(state.config.theme),
        hasFallback: false,
      })
      if (result) arbitraryValue = result
      return Boolean(result)
    })

    throwIf(!arbitraryValue, () =>
      logBadGood(
        `The arbitrary value in “${property}-[${value}]” isn’t valid`,
        `Replace “${value}” with a valid ${config.value.join(
          ' or '
        )} based value`
      )
    )

    return arbitraryValue
  }

  if (pieces.hasAlpha) {
    throwIf(!config.coerced || !config.coerced.color, () =>
      logBadGood(
        `There is no support for a “${property}” alpha value in “${property}-[${value}]”`
      )
    )
    return typeMap.color({
      config: config.coerced.color,
      value,
      pieces,
      theme: getTheme(state.config.theme),
      hasFallback: false,
    })
  }

  const arbitraryProperty = config.prop

  const color = props => withAlpha({ color: value, pieces, ...props })

  const arbitraryValue =
    typeof config.value === 'function'
      ? config.value({
          value,
          transparentTo,
          color,
          negative: pieces.negative,
          isEmotion: state.isEmotion,
        })
      : maybeAddNegative(value, pieces.negative)

  // Raw values - no prop value found in config
  if (!arbitraryProperty)
    return arbitraryValue ? arbitraryValue : showSuggestions(property, value)

  if (Array.isArray(arbitraryProperty))
    return arbitraryProperty.reduce(
      (result, p) => ({ ...result, [p]: arbitraryValue }),
      {}
    )

  return { [arbitraryProperty]: arbitraryValue }
}
