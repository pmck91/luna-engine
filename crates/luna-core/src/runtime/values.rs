//! Typed value access and checked arithmetic; mutations dispatch through value watches.
use super::Run;
use crate::TraceKind;
use anyhow::{Context, Result, bail, ensure};
use luna_model::{ArithmeticOperation, NumericOperand, Value, ValueTarget};

impl<'a> Run<'a> {
    pub(super) fn variable(&self, name: &str) -> Option<&Value> {
        self.state.variables.get(name)
    }

    pub(super) fn property(&self, entity: &str, name: &str) -> Option<&Value> {
        self.state
            .properties
            .get(entity)
            .and_then(|properties| properties.get(name))
    }

    fn numeric_operand(&self, operand: &NumericOperand) -> Result<i32> {
        let value = match operand {
            NumericOperand::Literal { value } => return Ok(*value),
            NumericOperand::Variable { name } => self.variable(name),
            NumericOperand::Property { entity, name } => self.property(entity, name),
        };
        match value {
            Some(Value::Integer(value)) => Ok(*value),
            _ => bail!("Arithmetic operand must reference an integer"),
        }
    }

    pub(super) fn value(&self, target: &ValueTarget) -> Result<&Value> {
        match target {
            ValueTarget::Variable { name } => self.variable(name),
            ValueTarget::Property { entity, name } => self.property(entity, name),
        }
        .context("Unknown variable/property")
    }

    fn update_integer(target: &mut Value, op: ArithmeticOperation, operand: i32) -> Result<()> {
        let Value::Integer(current) = target else {
            bail!("Arithmetic target must be an integer");
        };
        ensure!(
            op != ArithmeticOperation::Divide || operand != 0,
            "Cannot divide by zero"
        );
        let result = match op {
            ArithmeticOperation::Add => current.checked_add(operand),
            ArithmeticOperation::Subtract => current.checked_sub(operand),
            ArithmeticOperation::Multiply => current.checked_mul(operand),
            ArithmeticOperation::Divide => current.checked_div(operand),
        }
        .context("Integer arithmetic overflow")?;
        *current = result;
        Ok(())
    }

    pub(super) fn update_value(
        &mut self,
        target: ValueTarget,
        op: ArithmeticOperation,
        operand: &NumericOperand,
    ) -> Result<()> {
        let operand = self.numeric_operand(operand)?;
        let mut value = self.value(&target)?.clone();
        if self.recording.is_none() {
            Self::update_integer(&mut value, op, operand)?;
            return self.set_value(&target, value);
        }
        self.traced(
            TraceKind::Arithmetic {
                target: target.clone(),
                op,
                before: value.clone(),
                operand,
                result: None,
            },
            self.child_source("operand"),
            false,
            |this| {
                Self::update_integer(&mut value, op, operand)?;
                this.arithmetic_result(&value);
                this.set_value(&target, value)
            },
        )
    }
}
