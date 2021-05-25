import * as cloudwatch from '@aws-cdk/aws-cloudwatch';
import * as iam from '@aws-cdk/aws-iam';
import * as kinesis from '@aws-cdk/aws-kinesis';
import * as kms from '@aws-cdk/aws-kms';
import { IResource, Resource, Stack } from '@aws-cdk/core';
import { Construct } from 'constructs';
import { IDestination } from './destination';
import { CfnDeliveryStream } from './kinesisfirehose.generated';

/**
 * Represents a Kinesis Data Firehose delivery stream.
 */
export interface IDeliveryStream extends IResource, iam.IGrantable {
  /**
   * Name of the delivery stream.
   *
   * @attribute
   */
  readonly deliveryStreamName: string;

  /**
   * ARN of the delivery stream.
   *
   * @attribute
   */
  readonly deliveryStreamArn: string;

  /**
   * Grant the given identity permissions to perform the given actions.
   */
  grant(grantee: iam.IGrantable, ...actions: string[]): iam.Grant;

  /**
   * Grant the given identity permissions to write data to this stream.
   */
  grantWrite(grantee: iam.IGrantable): iam.Grant;

  /**
   * Return the given named metric for this delivery stream
   */
  metric(metricName: string, props?: cloudwatch.MetricOptions): cloudwatch.Metric;
}

/**
 * Options for server-side encryption of a delivery stream
 */
export enum StreamEncryption {
  /**
   * Data in the stream is stored unencrypted.
   */
  UNENCRYPTED,

  /**
   * Data in the stream is stored encrypted by a KMS key managed by the customer.
   */
  CUSTOMER_MANAGED,

  /**
   * Data in the stream is stored encrypted by a KMS key owned by AWS and managed for use in multiple AWS accounts.
   */
  AWS_OWNED
}

/**
 * Properties for a new delivery stream
 */
export interface DeliveryStreamProps {
  /**
   * The destination that this delivery stream will deliver data to.
   *
   * TODO: figure out if multiple destinations are supported (API return value seems to indicate so) and convert this to a list
   */
  readonly destination: IDestination;

  /**
   * A name for the delivery stream.
   *
   * @default - a name is generated by CloudFormation.
   */
  readonly deliveryStreamName?: string;

  /**
   * The Kinesis data stream to use as a source for this delivery stream.
   *
   * @default - data is written to the delivery stream via a direct put.
   */
  readonly sourceStream?: kinesis.IStream;

  /**
   * The IAM role assumed by Kinesis Firehose to read from sources, invoke processors, and write to destinations
   *
   * @default - a role will be created with default permissions
   */
  readonly role?: iam.IRole;

  /**
   * Indicates the type of customer master key (CMK) to use for server-side encryption.
   *
   * If `encryptionKey` is provided, this will be implicitly set to `CUSTOMER_MANAGED`.
   *
   * @default - unencrypted.
   */
  readonly encryption?: StreamEncryption;

  /**
   * Customer managed key to server-side encrypt data in the stream.
   *
   * @default - if `encryption` is set to `CUSTOMER_MANAGED`, a KMS key will be created for you.
   */
  readonly encryptionKey?: kms.IKey;
}

/**
 * Base class for new and imported Kinesis Data Firehose delivery streams
 */
export abstract class DeliveryStreamBase extends Resource implements IDeliveryStream {

  abstract readonly deliveryStreamName: string;

  abstract readonly deliveryStreamArn: string;

  abstract readonly grantPrincipal: iam.IPrincipal;

  public grant(grantee: iam.IGrantable, ...actions: string[]): iam.Grant {
    return iam.Grant.addToPrincipal({
      resourceArns: [this.deliveryStreamArn],
      grantee: grantee,
      actions: actions,
    });
  }

  public grantWrite(grantee: iam.IGrantable): iam.Grant {
    return this.grant(grantee, 'firehose:PutRecord', 'firehose:PutRecordBatch');
  }

  public metric(metricName: string, props?: cloudwatch.MetricOptions): cloudwatch.Metric {
    return new cloudwatch.Metric({
      namespace: 'AWS/Firehose',
      metricName: metricName,
      dimensions: {
        DeliveryStreamName: this.deliveryStreamName,
      },
      ...props,
    });
  }
}

/**
 * Create a Kinesis Data Firehose delivery stream
 *
 * @resource AWS::KinesisFirehose::DeliveryStream
 */
export class DeliveryStream extends DeliveryStreamBase {
  /**
   * Import an existing delivery stream from its name.
   */
  static fromDeliveryStreamName(scope: Construct, id: string, deliveryStreamName: string): IDeliveryStream {
    class Import extends DeliveryStreamBase {
      public readonly deliveryStreamName = deliveryStreamName;
      public readonly deliveryStreamArn = Stack.of(scope).formatArn({
        service: 'firehose',
        resource: 'deliverystream',
        resourceName: deliveryStreamName,
      })
      public readonly grantPrincipal = new iam.UnknownPrincipal({ resource: this });
    }
    return new Import(scope, id);
  }

  readonly deliveryStreamName: string;

  readonly deliveryStreamArn: string;

  readonly grantPrincipal: iam.IPrincipal;

  constructor(scope: Construct, id: string, props: DeliveryStreamProps) {
    super(scope, id);

    this.grantPrincipal = props.role ?? new iam.Role(this, 'Service Role', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
    });

    const resource = new CfnDeliveryStream(this, 'Resource');

    this.deliveryStreamName = resource.ref;
    this.deliveryStreamArn = resource.attrArn;
  }
}